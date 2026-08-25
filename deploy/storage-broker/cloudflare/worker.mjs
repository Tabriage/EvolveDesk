import {
  MAX_CREDENTIAL_BROKER_RESPONSE_BYTES,
  createCredentialBrokerRuntimeChallenge,
  inspectCredentialBrokerRequest,
  inspectCredentialBrokerRuntimeRelease,
} from "../../../app/features/sync-credential-broker.mjs";
import { createR2LocalCredentialClaims } from "../../../app/features/sync-storage-scope.mjs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const WORKER_SCRIPT_NAME = "evolve-desk-r2-credential-broker";

function text(value, label, maximum = 8_192, minimum = 1) {
  const candidate = String(value || "").trim();
  if (candidate.length < minimum || candidate.length > maximum || /[\u0000-\u001f\u007f]/.test(candidate)) throw new Error(`${label}配置无效`);
  return candidate;
}

function normalizeAllowedOrigin(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("ALLOWED_ORIGIN 配置无效"); }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("ALLOWED_ORIGIN 必须使用 HTTPS；只有本地预览可以使用回环 HTTP");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("ALLOWED_ORIGIN 不能包含路径、凭据、查询或片段");
  return url.origin;
}

function validateConfig(env) {
  const accountId = text(env?.R2_ACCOUNT_ID, "R2 Account ID", 32, 32).toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error("R2 Account ID 配置无效");
  const release = inspectCredentialBrokerRuntimeRelease({
    ci: {
      system: "cloudflare-workers-builds",
      repository: env?.EVOLVE_RELEASE_REPOSITORY,
      commit: env?.EVOLVE_RELEASE_COMMIT,
      branch: env?.EVOLVE_RELEASE_BRANCH,
      buildUuid: env?.EVOLVE_CLOUDFLARE_BUILD_UUID,
    },
    runtime: {
      provider: "cloudflare-workers",
      scriptName: WORKER_SCRIPT_NAME,
      versionId: env?.CF_VERSION_METADATA?.id,
      versionTag: env?.CF_VERSION_METADATA?.tag,
      versionCreatedAt: env?.CF_VERSION_METADATA?.timestamp,
    },
  });
  return {
    allowedOrigin: normalizeAllowedOrigin(env?.ALLOWED_ORIGIN),
    bearerToken: text(env?.BROKER_TOKEN, "BROKER_TOKEN", 8_192, 16),
    accountId,
    accessKeyId: text(env?.R2_ACCESS_KEY_ID, "R2 Access Key ID", 128, 8),
    secretAccessKey: text(env?.R2_SECRET_ACCESS_KEY, "R2 Secret Access Key", 256, 8),
    release,
  };
}

function bytes(value) {
  return value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
}

function bytesToBase64(value) {
  let binary = "";
  for (const part of value) binary += String.fromCharCode(part);
  return btoa(binary);
}

function base64url(value) {
  return bytesToBase64(bytes(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlJson(value) {
  return base64url(JSON.stringify(value));
}

function hex(value) {
  return [...value].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function safeEqual(leftValue, rightValue) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes(leftValue)),
    crypto.subtle.digest("SHA-256", bytes(rightValue)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function readRequestJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("续签请求超过 64 KiB 上限");
  if (!request.body) throw new Error("续签请求不是有效 JSON");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("续签请求超过 64 KiB 上限");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); } catch { throw new Error("续签请求不是有效 JSON"); }
}

function corsHeaders(origin, allowedOrigin) {
  return origin === allowedOrigin ? {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Evolve-Runtime-Challenge",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  } : {};
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

async function issueCredentials(request, config, nowValue) {
  if (request.provider !== "cloudflare-r2") throw new Error("Cloudflare Worker 模板只签发 R2 临时凭据");
  if (request.scope.accountId !== config.accountId) throw new Error("请求的 R2 Account ID 不在本 Worker 授权范围内");
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw new Error("凭据签发时间无效");
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAtSeconds = issuedAt + request.ttlSeconds;
  const claims = createR2LocalCredentialClaims(request.scope);
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64urlJson({
    ...claims,
    sub: config.accountId,
    iss: config.accessKeyId,
    aud: `${config.accountId}.r2.cloudflarestorage.com`,
    iat: issuedAt,
    exp: expiresAtSeconds,
  });
  const unsignedToken = `${header}.${payload}`;
  const hmacKey = await crypto.subtle.importKey("raw", bytes(config.secretAccessKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, bytes(unsignedToken))));
  const signedToken = `${unsignedToken}.${signature}`;
  const temporarySecret = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(signedToken))));
  return {
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: temporarySecret,
      sessionToken: bytesToBase64(bytes(`jwt/${signedToken}`)),
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    },
  };
}

export async function handleCloudflareBrokerRequest(request, env, nowValue = new Date()) {
  let config;
  try { config = validateConfig(env); } catch (error) {
    return jsonResponse(503, { error: error instanceof Error ? error.message : "Worker 配置无效" });
  }
  const origin = request.headers.get("origin") || "";
  const cors = corsHeaders(origin, config.allowedOrigin);
  try {
    const url = new URL(request.url);
    const loopback = LOOPBACK.has(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return jsonResponse(403, { error: "部署端点必须使用 HTTPS" }, cors);
    if (origin && origin !== config.allowedOrigin) return jsonResponse(403, { error: "请求 Origin 不受信任" });
    if (url.search || url.hash || !new Set(["/health", "/credentials"]).has(url.pathname)) return jsonResponse(404, { error: "端点不存在" }, cors);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!await safeEqual(request.headers.get("authorization") || "", `Bearer ${config.bearerToken}`)) return jsonResponse(401, { error: "访问令牌无效" }, cors);
    if (request.method === "GET" && url.pathname === "/health") {
      const challengeValue = request.headers.get("x-evolve-runtime-challenge") || "";
      const challenge = challengeValue
        ? await createCredentialBrokerRuntimeChallenge(challengeValue, config.release)
        : undefined;
      return jsonResponse(200, {
        ok: true,
        service: "evolve-desk-storage-broker",
        providers: { cloudflareR2: true, amazonS3: false },
        release: config.release,
        ...(challenge ? { challenge } : {}),
      }, cors);
    }
    if (request.method !== "POST" || url.pathname !== "/credentials") return jsonResponse(404, { error: "端点不存在" }, cors);
    if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return jsonResponse(415, { error: "只接受 application/json" }, cors);
    const credentialRequest = inspectCredentialBrokerRequest(await readRequestJson(request));
    return jsonResponse(200, await issueCredentials(credentialRequest, config, nowValue), cors);
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : "凭据签发失败" }, cors);
  }
}

const worker = {
  fetch(request, env) {
    return handleCloudflareBrokerRequest(request, env);
  },
};

export default worker;
