import { inspectAwsCredentialLifecycle, normalizeAwsSigV4Credentials } from "./aws-sigv4.mjs";
import { createSyncStorageScopeTicket } from "./sync-storage-scope.mjs";

export const MAX_CREDENTIAL_BROKER_RESPONSE_BYTES = 64 * 1_024;
export const MIN_CREDENTIAL_TTL_SECONDS = 5 * 60;
export const MAX_CREDENTIAL_TTL_SECONDS = 7 * 24 * 60 * 60;

const MAX_BROKER_TOKEN_CHARS = 8_192;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label}格式无效`);
  return value;
}

function exactKeys(value, keys, label) {
  const candidate = plainObject(value, label);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label}字段无效`);
  return candidate;
}

function boundedText(value, label, maximum, pattern) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > maximum || /[\u0000-\u001f\u007f]/.test(candidate) || (pattern && !pattern.test(candidate))) throw new Error(`${label}无效`);
  return candidate;
}

function normalizeRuntimeRelease(value) {
  if (value === undefined) return undefined;
  const release = exactKeys(value, ["ci", "runtime"], "凭据代理运行时来源");
  const ci = exactKeys(release.ci, ["commit", "ref", "repository", "runAttempt", "runId", "system", "workflowPath"], "凭据代理 CI 来源");
  const runtime = exactKeys(release.runtime, ["functionName", "immutableVersion", "provider", "region"], "凭据代理云端运行时");
  if (ci.system !== "github-actions") throw new Error("凭据代理 CI 系统无效");
  if (runtime.provider !== "aws-lambda") throw new Error("凭据代理云端运行时无效");
  if (!Number.isSafeInteger(ci.runAttempt) || ci.runAttempt < 1) throw new Error("凭据代理 Run Attempt 无效");
  return {
    ci: {
      system: "github-actions",
      repository: boundedText(ci.repository, "凭据代理 CI 仓库", 180, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      commit: boundedText(ci.commit, "凭据代理 CI 提交", 40, /^[0-9a-f]{40}$/),
      ref: boundedText(ci.ref, "凭据代理 CI Ref", 260, /^refs\/heads\/(?!.*\.\.)(?!.*\/$)[A-Za-z0-9._/-]+$/),
      workflowPath: boundedText(ci.workflowPath, "凭据代理 CI 工作流", 220, /^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/),
      runId: boundedText(ci.runId, "凭据代理 CI Run ID", 32, /^[1-9][0-9]*$/),
      runAttempt: ci.runAttempt,
    },
    runtime: {
      provider: "aws-lambda",
      region: boundedText(runtime.region, "凭据代理 AWS Region", 32, /^[a-z0-9][a-z0-9-]{1,31}$/),
      functionName: boundedText(runtime.functionName, "凭据代理 Lambda 函数名", 64, /^[A-Za-z0-9-_]+$/),
      immutableVersion: boundedText(runtime.immutableVersion, "凭据代理 Lambda 不可变版本", 12, /^[1-9][0-9]*$/),
    },
  };
}

export function inspectCredentialBrokerRuntimeRelease(value) {
  return normalizeRuntimeRelease(value);
}

function normalizeBrokerUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("请输入有效的短期凭据续签服务 URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) throw new Error("续签服务必须使用 HTTPS；只有本机回环地址可以使用 HTTP");
  if (url.username || url.password || url.search || url.hash) throw new Error("续签服务 URL 不能包含凭据、查询或片段");
  return url.toString();
}

function normalizeBrokerToken(value) {
  const token = String(value || "").trim();
  if (token.length > MAX_BROKER_TOKEN_CHARS || /[\r\n]/.test(token)) throw new Error("续签服务访问令牌格式无效");
  return token;
}

function normalizeTtl(value) {
  const ttlSeconds = Number(value);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_CREDENTIAL_TTL_SECONDS || ttlSeconds > MAX_CREDENTIAL_TTL_SECONDS) {
    throw new Error("短期凭据期限必须为 300–604800 秒");
  }
  return ttlSeconds;
}

function stableValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("续签请求必须是普通 JSON 对象");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function credentialPayload(parsed) {
  if (parsed?.success === false) throw new Error("续签服务拒绝签发短期凭据");
  return parsed?.result || parsed?.Credentials || parsed?.credentials || parsed;
}

function valueFrom(payload, ...names) {
  for (const name of names) if (payload?.[name] !== undefined && payload?.[name] !== null) return payload[name];
  return undefined;
}

export function createCredentialBrokerRequest(scopeValue) {
  const ttlSeconds = normalizeTtl(scopeValue?.ttlSeconds);
  const ticket = createSyncStorageScopeTicket(scopeValue?.provider, {
    accountId: scopeValue?.accountId,
    bucket: scopeValue?.bucket,
    objectKey: scopeValue?.objectKey,
    region: scopeValue?.region,
    ttlSeconds,
  });
  return {
    format: "evolve-desk-storage-credential-request",
    version: 1,
    provider: ticket.provider,
    scope: {
      ...(ticket.target.accountId ? { accountId: ticket.target.accountId } : {}),
      bucket: ticket.target.bucket,
      objectKey: ticket.target.objectKey,
      region: ticket.target.region,
      operations: [...ticket.operations],
    },
    ttlSeconds,
  };
}

export function inspectCredentialBrokerRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("续签请求格式无效");
  if (value.format !== "evolve-desk-storage-credential-request" || value.version !== 1) throw new Error("续签请求版本不受支持");
  const scope = value.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new Error("续签请求范围无效");
  const expected = createCredentialBrokerRequest({
    provider: value.provider,
    accountId: scope.accountId,
    bucket: scope.bucket,
    objectKey: scope.objectKey,
    region: scope.region,
    ttlSeconds: value.ttlSeconds,
  });
  if (stableJson(value) !== stableJson(expected)) throw new Error("续签请求与当前单对象 GET/PUT 最小权限规范不等价");
  return expected;
}

export function normalizeCredentialBrokerResponse(parsed, request, nowValue = new Date()) {
  const payload = credentialPayload(parsed);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw new Error("续签响应检查时间无效");
  const explicitExpiration = valueFrom(payload, "expiresAt", "Expiration", "expiration")
    ?? valueFrom(parsed, "expiresAt", "Expiration", "expiration");
  const expiresAt = explicitExpiration || new Date(now.getTime() + request.ttlSeconds * 1_000).toISOString();
  const credentials = normalizeAwsSigV4Credentials({
    accessKeyId: valueFrom(payload, "accessKeyId", "AccessKeyId"),
    secretAccessKey: valueFrom(payload, "secretAccessKey", "SecretAccessKey", "SecretKey"),
    sessionToken: valueFrom(payload, "sessionToken", "SessionToken"),
    region: request.scope.region,
    expiresAt,
  });
  if (!credentials.sessionToken) throw new Error("续签服务没有返回 Session Token，已拒绝把结果当作短期凭据");
  const lifecycle = inspectAwsCredentialLifecycle(credentials, now);
  if (!lifecycle.usable) throw new Error("续签服务返回的凭据已经到期或剩余不足 30 秒");
  if ((lifecycle.remainingMs || 0) > request.ttlSeconds * 1_000 + 60_000) throw new Error("续签服务返回的期限超过本次申请寿命");
  return credentials;
}

export async function renewSyncStorageCredentials(configValue, scopeValue, fetchImpl = globalThis.fetch, nowImpl = () => new Date()) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持短期凭据续签");
  const endpointUrl = normalizeBrokerUrl(configValue?.endpointUrl);
  const bearerToken = normalizeBrokerToken(configValue?.bearerToken);
  const request = createCredentialBrokerRequest(scopeValue);
  const requestedAt = nowImpl();
  let response;
  try {
    response = await fetchImpl(endpointUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=utf-8",
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      body: JSON.stringify(request),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new Error("无法访问短期凭据续签服务，请检查地址、CORS 与网络权限");
  }
  if (response.status === 401 || response.status === 403) throw new Error("续签服务拒绝访问，请检查当前页面内存中的访问令牌");
  if (response.status !== 200) throw new Error(`续签服务返回 HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("续签服务响应超过 64 KiB 上限");
  const raw = await response.text();
  if (byteLength(raw) > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("续签服务响应超过 64 KiB 上限");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("续签服务没有返回有效 JSON");
  }
  return {
    credentials: normalizeCredentialBrokerResponse(parsed, request, requestedAt),
    requestedAt: new Date(requestedAt).toISOString(),
    ttlSeconds: request.ttlSeconds,
  };
}

export async function inspectCredentialBrokerHealth(configValue, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持本地凭据代理检查");
  const endpointUrl = new URL(normalizeBrokerUrl(configValue?.endpointUrl));
  const healthUrl = new URL("./health", endpointUrl);
  const bearerToken = normalizeBrokerToken(configValue?.bearerToken);
  let response;
  try {
    response = await fetchImpl(healthUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new Error("无法访问本地凭据代理，请检查地址、进程与 CORS 配置");
  }
  if (response.status === 401 || response.status === 403) throw new Error("本地凭据代理拒绝访问，请检查 Bearer");
  if (response.status !== 200) throw new Error(`本地凭据代理健康检查返回 HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("本地凭据代理健康响应超过 64 KiB 上限");
  const raw = await response.text();
  if (byteLength(raw) > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("本地凭据代理健康响应超过 64 KiB 上限");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("本地凭据代理没有返回有效 JSON");
  }
  if (parsed?.ok !== true || parsed?.service !== "evolve-desk-storage-broker"
    || typeof parsed?.providers?.cloudflareR2 !== "boolean" || typeof parsed?.providers?.amazonS3 !== "boolean") {
    throw new Error("本地凭据代理健康响应格式无效");
  }
  const release = inspectCredentialBrokerRuntimeRelease(parsed.release);
  return {
    ok: true,
    service: "evolve-desk-storage-broker",
    providers: { cloudflareR2: parsed.providers.cloudflareR2, amazonS3: parsed.providers.amazonS3 },
    ...(release ? { release } : {}),
  };
}
