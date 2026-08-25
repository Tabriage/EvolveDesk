import { timingSafeEqual } from "node:crypto";
import {
  MAX_CREDENTIAL_BROKER_RESPONSE_BYTES,
  inspectCredentialBrokerRuntimeRelease,
  inspectCredentialBrokerRequest,
} from "../../../app/features/sync-credential-broker.mjs";
import {
  issueAwsTemporaryCredentials,
  validateAwsIssuerConfig,
} from "../../../tools/storage-credential-issuers.mjs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

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

function runtimeRelease(env, region) {
  const names = [
    "EVOLVE_RELEASE_REPOSITORY",
    "EVOLVE_RELEASE_COMMIT",
    "EVOLVE_RELEASE_REF",
    "EVOLVE_RELEASE_WORKFLOW",
    "EVOLVE_RELEASE_RUN_ID",
    "EVOLVE_RELEASE_RUN_ATTEMPT",
  ];
  if (names.every((name) => !String(env?.[name] || "").trim())) return undefined;
  if (String(env?.AWS_REGION || "").trim() !== region) throw new Error("AWS_REGION 与签发区域不一致");
  return inspectCredentialBrokerRuntimeRelease({
    ci: {
      system: "github-actions",
      repository: env?.EVOLVE_RELEASE_REPOSITORY,
      commit: env?.EVOLVE_RELEASE_COMMIT,
      ref: env?.EVOLVE_RELEASE_REF,
      workflowPath: env?.EVOLVE_RELEASE_WORKFLOW,
      runId: env?.EVOLVE_RELEASE_RUN_ID,
      runAttempt: Number(env?.EVOLVE_RELEASE_RUN_ATTEMPT),
    },
    runtime: {
      provider: "aws-lambda",
      region: env?.AWS_REGION,
      functionName: env?.AWS_LAMBDA_FUNCTION_NAME,
      immutableVersion: env?.AWS_LAMBDA_FUNCTION_VERSION,
    },
  });
}

function validateConfig(env) {
  const allowedOrigin = normalizeAllowedOrigin(env?.ALLOWED_ORIGIN);
  const bearerToken = text(env?.BROKER_TOKEN, "BROKER_TOKEN", 8_192, 16);
  const issuer = validateAwsIssuerConfig({
    roleArn: env?.EVOLVE_AWS_ROLE_ARN,
    region: env?.EVOLVE_AWS_REGION,
    externalId: env?.EVOLVE_AWS_EXTERNAL_ID,
    accessKeyId: env?.AWS_ACCESS_KEY_ID,
    secretAccessKey: env?.AWS_SECRET_ACCESS_KEY,
    sessionToken: env?.AWS_SESSION_TOKEN,
  });
  if (!issuer.allowedRegion) throw new Error("EVOLVE_AWS_REGION 配置无效");
  return { allowedOrigin, bearerToken, issuer, release: runtimeRelease(env, issuer.allowedRegion) };
}

function normalizeHeaders(value) {
  const headers = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return headers;
  for (const [name, headerValue] of Object.entries(value)) headers[String(name).toLowerCase()] = String(headerValue || "");
  return headers;
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function corsHeaders(origin, allowedOrigin) {
  return origin === allowedOrigin ? {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  } : {};
}

function response(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-store", ...headers },
    body: payload === null ? "" : JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

function readEventJson(event) {
  const raw = event?.isBase64Encoded ? Buffer.from(String(event.body || ""), "base64") : Buffer.from(String(event?.body || ""), "utf8");
  if (raw.byteLength > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("续签请求超过 64 KiB 上限");
  try { return JSON.parse(raw.toString("utf8")); } catch { throw new Error("续签请求不是有效 JSON"); }
}

export async function handleAwsLambdaBrokerEvent(event, env, options = {}) {
  let config;
  try { config = validateConfig(env); } catch (error) {
    return response(503, { error: error instanceof Error ? error.message : "Lambda 配置无效" });
  }
  if (event?.version !== "2.0") return response(400, { error: "只接受 Lambda Function URL payload v2.0" });
  const headers = normalizeHeaders(event.headers);
  const origin = headers.origin || "";
  const cors = corsHeaders(origin, config.allowedOrigin);
  try {
    const path = String(event.rawPath || event.requestContext?.http?.path || "");
    const method = String(event.requestContext?.http?.method || "").toUpperCase();
    if (origin && origin !== config.allowedOrigin) return response(403, { error: "请求 Origin 不受信任" });
    if (event.rawQueryString || !new Set(["/health", "/credentials"]).has(path)) return response(404, { error: "端点不存在" }, cors);
    if (method === "OPTIONS") return response(204, null, cors);
    if (!safeEqual(headers.authorization, `Bearer ${config.bearerToken}`)) return response(401, { error: "访问令牌无效" }, cors);
    if (method === "GET" && path === "/health") {
      return response(200, {
        ok: true,
        service: "evolve-desk-storage-broker",
        providers: { cloudflareR2: false, amazonS3: true },
        ...(config.release ? { release: config.release } : {}),
      }, cors);
    }
    if (method !== "POST" || path !== "/credentials") return response(404, { error: "端点不存在" }, cors);
    if (!String(headers["content-type"] || "").toLowerCase().startsWith("application/json")) return response(415, { error: "只接受 application/json" }, cors);
    const credentialRequest = inspectCredentialBrokerRequest(readEventJson(event));
    if (credentialRequest.provider !== "amazon-s3") throw new Error("AWS Lambda 模板只签发 Amazon S3 临时凭据");
    const result = await issueAwsTemporaryCredentials(credentialRequest, config.issuer, {
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    return response(200, result, cors);
  } catch (error) {
    return response(400, { error: error instanceof Error ? error.message : "凭据签发失败" }, cors);
  }
}

export function handler(event) {
  return handleAwsLambdaBrokerEvent(event, process.env);
}
