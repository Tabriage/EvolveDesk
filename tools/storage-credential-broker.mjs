import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { inspectCredentialBrokerRequest, MAX_CREDENTIAL_BROKER_RESPONSE_BYTES } from "../app/features/sync-credential-broker.mjs";
import {
  issueAwsTemporaryCredentials,
  issueR2TemporaryCredentials,
  validateAwsIssuerConfig,
  validateR2IssuerConfig,
} from "./storage-credential-issuers.mjs";

const HOST = "127.0.0.1";
const port = Number(process.env.EVOLVE_STORAGE_BROKER_PORT || 4243);
if (!Number.isInteger(port) || (port !== 0 && port < 1_024) || port > 65_535) throw new Error("EVOLVE_STORAGE_BROKER_PORT 必须为 1024–65535；测试时可使用 0");

function originValue(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("EVOLVE_STORAGE_BROKER_ORIGIN 无效"); }
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("凭据代理 Origin 必须使用 HTTPS；只有回环地址可以使用 HTTP");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("凭据代理 Origin 不能包含路径、凭据、查询或片段");
  return url.origin;
}

const allowedOrigin = originValue(process.env.EVOLVE_STORAGE_BROKER_ORIGIN || "http://localhost:3000");
const bearerToken = String(process.env.EVOLVE_STORAGE_BROKER_TOKEN || "").trim();
if (bearerToken.length > 8_192 || /[\r\n]/.test(bearerToken)) throw new Error("EVOLVE_STORAGE_BROKER_TOKEN 无效");

function optionalGroup(name, values, requiredNames) {
  const count = requiredNames.filter((key) => values[key]).length;
  if (count > 0 && count !== requiredNames.length) throw new Error(`${name} 环境变量配置不完整`);
  return count === requiredNames.length ? values : null;
}

const r2ConfigValue = optionalGroup("R2", {
  accountId: process.env.EVOLVE_R2_ACCOUNT_ID,
  accessKeyId: process.env.EVOLVE_R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.EVOLVE_R2_SECRET_ACCESS_KEY,
}, ["accountId", "accessKeyId", "secretAccessKey"]);

const awsConfigValue = optionalGroup("AWS", {
  roleArn: process.env.EVOLVE_AWS_ROLE_ARN,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  sessionToken: process.env.AWS_SESSION_TOKEN,
  region: process.env.EVOLVE_AWS_REGION,
  externalId: process.env.EVOLVE_AWS_EXTERNAL_ID,
}, ["roleArn", "accessKeyId", "secretAccessKey"]);
const r2Config = r2ConfigValue ? validateR2IssuerConfig(r2ConfigValue) : null;
const awsConfig = awsConfigValue ? validateAwsIssuerConfig(awsConfigValue) : null;

function authorized(request) {
  if (!bearerToken) return true;
  const supplied = String(request.headers.authorization || "");
  const expected = `Bearer ${bearerToken}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

function requestIsLocal(request) {
  const remote = request.socket.remoteAddress || "";
  const host = String(request.headers.host || "").toLowerCase();
  const activePort = server.address()?.port || port;
  return (remote === "127.0.0.1" || remote === "::ffff:127.0.0.1")
    && (host === `127.0.0.1:${activePort}` || host === `localhost:${activePort}`);
}

function corsHeaders(request) {
  return request.headers.origin === allowedOrigin ? {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  } : {};
}

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body), ...headers });
  response.end(body);
}

async function readJson(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("续签请求超过 64 KiB 上限");
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("续签请求超过 64 KiB 上限");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("续签请求不是有效 JSON"); }
}

const server = createServer(async (request, response) => {
  const cors = corsHeaders(request);
  try {
    if (!requestIsLocal(request)) return sendJson(response, 403, { error: "仅允许本机回环访问" });
    if (request.headers.origin && request.headers.origin !== allowedOrigin) return sendJson(response, 403, { error: "请求 Origin 不受信任" });
    if (request.method === "OPTIONS") return response.writeHead(204, cors).end();
    if (!authorized(request)) return sendJson(response, 401, { error: "访问令牌无效" }, cors);
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.search || url.hash) return sendJson(response, 404, { error: "端点不存在" }, cors);
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "evolve-desk-storage-broker",
        providers: { cloudflareR2: Boolean(r2Config), amazonS3: Boolean(awsConfig) },
      }, cors);
    }
    if (request.method !== "POST" || url.pathname !== "/credentials") return sendJson(response, 404, { error: "端点不存在" }, cors);
    if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return sendJson(response, 415, { error: "只接受 application/json" }, cors);
    const credentialRequest = inspectCredentialBrokerRequest(await readJson(request));
    let result;
    if (credentialRequest.provider === "cloudflare-r2") {
      if (!r2Config) return sendJson(response, 503, { error: "R2 签发器未配置" }, cors);
      result = issueR2TemporaryCredentials(credentialRequest, r2Config);
    } else {
      if (!awsConfig) return sendJson(response, 503, { error: "AWS 签发器未配置" }, cors);
      result = await issueAwsTemporaryCredentials(credentialRequest, awsConfig);
    }
    return sendJson(response, 200, result, cors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "凭据签发失败";
    return sendJson(response, 400, { error: message }, cors);
  }
});

server.listen(port, HOST, () => {
  const activePort = server.address().port;
  console.log(`EvolveDesk storage credential broker: http://${HOST}:${activePort}/credentials`);
  console.log(`Providers: R2=${Boolean(r2Config)} AWS=${Boolean(awsConfig)}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
