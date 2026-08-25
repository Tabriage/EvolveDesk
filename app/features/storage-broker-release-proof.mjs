export const MAX_STORAGE_BROKER_RELEASE_PROOF_BYTES = 128 * 1_024;

export const STORAGE_BROKER_RELEASE_TARGETS = Object.freeze({
  "cloudflare-worker-r2": Object.freeze({
    provider: "cloudflare-r2",
    runtime: "cloudflare-workers",
    issuer: "r2-local-jwt-hs256",
    ttlRangeSeconds: Object.freeze([300, 604800]),
    requiredSecretNames: Object.freeze(["ALLOWED_ORIGIN", "BROKER_TOKEN", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]),
    files: Object.freeze([
      "app/features/aws-sigv4.mjs",
      "app/features/storage-broker-cloudflare-deployment-proof.mjs",
      "app/features/sync-credential-broker.mjs",
      "app/features/sync-storage-recipes.mjs",
      "app/features/sync-storage-scope.mjs",
      "deploy/storage-broker/cloudflare/worker.mjs",
      "deploy/storage-broker/cloudflare/wrangler.jsonc",
      "tools/cloudflare-storage-broker-deploy.mjs",
    ]),
  }),
  "aws-lambda-s3": Object.freeze({
    provider: "amazon-s3",
    runtime: "aws-lambda-nodejs22",
    issuer: "sts-assume-role-inline-session-policy",
    ttlRangeSeconds: Object.freeze([900, 43200]),
    requiredSecretNames: Object.freeze(["ALLOWED_ORIGIN", "BROKER_TOKEN", "AWS_EXECUTION_ROLE_CREDENTIALS", "EVOLVE_AWS_ROLE_ARN", "EVOLVE_AWS_REGION"]),
    files: Object.freeze([
      "Makefile",
      "app/features/aws-sigv4.mjs",
      "app/features/sync-credential-broker.mjs",
      "app/features/sync-storage-recipes.mjs",
      "app/features/sync-storage-scope.mjs",
      "deploy/storage-broker/aws-lambda/handler.mjs",
      "deploy/storage-broker/aws-lambda/template.yaml",
      "tools/storage-credential-issuers.mjs",
    ]),
  }),
});

function bytes(value) {
  return new TextEncoder().encode(String(value));
}

function hex(value) {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持发布封签所需的 Web Crypto");
  return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes(value)));
}

function stableValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("发布封签必须是普通 JSON 对象");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function text(value, label, maximum, pattern) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > maximum || /[\u0000-\u001f\u007f]/.test(candidate) || (pattern && !pattern.test(candidate))) throw new Error(`${label}无效`);
  return candidate;
}

function isoDate(value) {
  const candidate = text(value, "发布时间", 64);
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== candidate || date.getUTCFullYear() < 2020 || date.getUTCFullYear() > 2200) throw new Error("发布时间无效");
  return candidate;
}

function origin(value, label) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error(`${label}无效`); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`${label}必须是无路径、凭据、查询或片段的 HTTPS Origin`);
  return url.origin;
}

function repositoryUrl(value) {
  const candidate = text(value, "源码仓库", 300);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(candidate)) throw new Error("源码仓库必须是无凭据的 GitHub HTTPS .git 地址");
  return candidate;
}

function capabilitiesFor(target) {
  const definition = STORAGE_BROKER_RELEASE_TARGETS[target];
  return {
    provider: definition.provider,
    runtime: definition.runtime,
    issuer: definition.issuer,
    operations: ["GetObject", "PutObject"],
    ttlRangeSeconds: [...definition.ttlRangeSeconds],
    exactObjectScope: true,
    bearerRequired: true,
    httpsRequired: true,
    publicEndpoint: true,
    maxRequestBytes: 65536,
    requiredSecretNames: [...definition.requiredSecretNames],
  };
}

function normalizeFiles(target, value) {
  const definition = STORAGE_BROKER_RELEASE_TARGETS[target];
  if (!Array.isArray(value)) throw new Error("发布文件摘要无效");
  const byPath = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("发布文件摘要无效");
    const path = text(item.path, "发布文件路径", 240, /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9._/-]+$/);
    const digest = text(item.sha256, "发布文件 SHA-256", 64, /^[0-9a-f]{64}$/);
    if (byPath.has(path)) throw new Error("发布文件摘要不能重复");
    byPath.set(path, digest);
  }
  if (byPath.size !== definition.files.length || definition.files.some((path) => !byPath.has(path))) throw new Error("发布文件集合与目标运行时规范不等价");
  return definition.files.map((path) => ({ path, sha256: byPath.get(path) }));
}

function normalizeBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("发布封签正文无效");
  const target = text(value.target, "发布目标", 40);
  const definition = STORAGE_BROKER_RELEASE_TARGETS[target];
  if (!definition) throw new Error("发布目标不受支持");
  const source = value.source;
  const deployment = value.deployment;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("发布源码来源无效");
  if (!deployment || typeof deployment !== "object" || Array.isArray(deployment)) throw new Error("发布端点配置无效");
  const endpointOrigin = origin(deployment.endpointOrigin, "代理端点 Origin");
  if (target === "aws-lambda-s3" && !/^[a-z0-9-]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/.test(new URL(endpointOrigin).hostname)) {
    throw new Error("AWS Lambda 发布封签必须绑定 Lambda Function URL Origin");
  }
  return {
    target,
    createdAt: isoDate(value.createdAt),
    source: {
      repository: repositoryUrl(source.repository),
      commit: text(source.commit, "源码提交", 40, /^[0-9a-f]{40}$/),
      branch: text(source.branch, "源码分支", 180, /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]+$/),
      clean: source.clean === true,
      remoteHeadVerified: source.remoteHeadVerified === true,
    },
    deployment: {
      endpointOrigin,
      credentialPath: "/credentials",
      healthPath: "/health",
      allowedWorkbenchOrigin: origin(deployment.allowedWorkbenchOrigin, "工作台 Origin"),
    },
    capabilities: capabilitiesFor(target),
    files: normalizeFiles(target, value.files),
  };
}

export async function createStorageBrokerReleaseProof(value) {
  const body = normalizeBody(value);
  if (!body.source.clean) throw new Error("只有干净 Git 工作树的已提交源码才能生成发布封签");
  if (!body.source.remoteHeadVerified) throw new Error("源码提交必须与 GitHub origin 的同名远端分支头一致");
  return {
    format: "evolve-desk-storage-broker-release-proof",
    version: 1,
    body,
    digest: { algorithm: "SHA-256", value: await sha256(stableJson(body)) },
  };
}

export async function inspectStorageBrokerReleaseProof(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("发布封签格式无效");
  if (value.format !== "evolve-desk-storage-broker-release-proof" || value.version !== 1) throw new Error("发布封签版本不受支持");
  const expected = await createStorageBrokerReleaseProof(value.body);
  if (stableJson(value) !== stableJson(expected)) throw new Error("发布封签字段、来源或 SHA-256 核对失败");
  return expected;
}

export async function inspectStorageBrokerReleaseProofText(rawValue) {
  const raw = String(rawValue || "");
  if (bytes(raw).byteLength > MAX_STORAGE_BROKER_RELEASE_PROOF_BYTES) throw new Error("发布封签超过 128 KiB 上限");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("发布封签不是有效 JSON"); }
  return inspectStorageBrokerReleaseProof(parsed);
}

export async function serializeStorageBrokerReleaseProof(value) {
  return `${JSON.stringify(await inspectStorageBrokerReleaseProof(value), null, 2)}\n`;
}
