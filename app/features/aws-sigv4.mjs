const MAX_ACCESS_KEY_CHARS = 128;
const MAX_SECRET_KEY_CHARS = 256;
const MAX_SESSION_TOKEN_CHARS = 16_384;
const REGION = /^(?:auto|[a-z0-9][a-z0-9-]{1,31})$/;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const FORBIDDEN_SIGNED_HEADERS = new Set(["authorization", "connection", "content-length", "host", "transfer-encoding", "user-agent"]);

function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 SigV4 所需的 Web Crypto");
  return globalThis.crypto;
}

function text(value, maximum, label, minimum = 0) {
  const candidate = String(value || "").trim();
  if (candidate.length < minimum || candidate.length > maximum || /[\u0000-\u001f\u007f]/.test(candidate)) throw new Error(`${label}格式无效`);
  return candidate;
}

function bytes(value) {
  return value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
}

function hex(value) {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  return hex(await requireCrypto().subtle.digest("SHA-256", bytes(value)));
}

async function hmacSha256(key, value) {
  const cryptoKey = await requireCrypto().subtle.importKey("raw", bytes(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await requireCrypto().subtle.sign("HMAC", cryptoKey, bytes(value)));
}

function awsUriEncode(value) {
  let encoded = "";
  for (const part of bytes(value)) {
    const character = String.fromCharCode(part);
    encoded += /[A-Za-z0-9._~-]/.test(character) ? character : `%${part.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

function canonicalPath(url) {
  try {
    return url.pathname.split("/").map((segment) => awsUriEncode(decodeURIComponent(segment))).join("/") || "/";
  } catch {
    throw new Error("S3 对象 URL 路径编码无效");
  }
}

function canonicalQuery(url) {
  const parts = [...url.searchParams.entries()].map(([key, value]) => [awsUriEncode(key), awsUriEncode(value)]);
  parts.sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  return parts.map(([key, value]) => `${key}=${value}`).join("&");
}

function canonicalHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function amzTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("SigV4 签名时间无效");
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function normalizeAwsSigV4Credentials(value) {
  const accessKeyId = text(value?.accessKeyId, MAX_ACCESS_KEY_CHARS, "S3 Access Key ID", 8);
  const secretAccessKey = text(value?.secretAccessKey, MAX_SECRET_KEY_CHARS, "S3 Secret Access Key", 8);
  const sessionToken = text(value?.sessionToken, MAX_SESSION_TOKEN_CHARS, "S3 Session Token");
  const region = text(value?.region, 32, "S3 区域", 2).toLowerCase();
  if (!REGION.test(region)) throw new Error("S3 区域格式无效");
  return { accessKeyId, secretAccessKey, sessionToken, region };
}

export async function createAwsSigV4Headers(credentialsValue, requestValue, nowValue = new Date()) {
  const credentials = normalizeAwsSigV4Credentials(credentialsValue);
  const method = String(requestValue?.method || "").trim().toUpperCase();
  if (!new Set(["GET", "HEAD", "PUT"]).has(method)) throw new Error("SigV4 请求方法不受支持");
  let url;
  try {
    url = new URL(String(requestValue?.url || ""));
  } catch {
    throw new Error("SigV4 请求 URL 无效");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("SigV4 请求必须使用 HTTPS；只有本机回环地址可以使用 HTTP");
  if (url.username || url.password || url.hash) throw new Error("SigV4 请求 URL 不能包含账号、密码或片段");

  const body = requestValue?.body === undefined ? "" : String(requestValue.body);
  const payloadHash = await sha256Hex(body);
  const timestamp = amzTimestamp(nowValue);
  const dateStamp = timestamp.slice(0, 8);
  const headers = new Map();
  for (const [nameValue, value] of Object.entries(requestValue?.headers || {})) {
    const name = String(nameValue).toLowerCase();
    if (!HEADER_NAME.test(nameValue) || FORBIDDEN_SIGNED_HEADERS.has(name)) throw new Error(`SigV4 请求头 ${nameValue} 不受支持`);
    if (value === undefined || value === null) continue;
    headers.set(name, canonicalHeaderValue(value));
  }
  headers.set("host", url.host);
  headers.set("x-amz-content-sha256", payloadHash);
  headers.set("x-amz-date", timestamp);
  if (credentials.sessionToken) headers.set("x-amz-security-token", credentials.sessionToken);

  const orderedHeaders = [...headers.entries()].sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = `${orderedHeaders.map(([name, value]) => `${name}:${value}`).join("\n")}\n`;
  const signedHeaders = orderedHeaders.map(([name]) => name).join(";");
  const canonicalRequest = [method, canonicalPath(url), canonicalQuery(url), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, credentialScope, await sha256Hex(canonicalRequest)].join("\n");
  const dateKey = await hmacSha256(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const regionKey = await hmacSha256(dateKey, credentials.region);
  const serviceKey = await hmacSha256(regionKey, "s3");
  const signingKey = await hmacSha256(serviceKey, "aws4_request");
  const signature = hex(await hmacSha256(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signature}`;

  const result = {};
  for (const [name, value] of headers) if (name !== "host") result[name] = value;
  result.Authorization = authorization;
  return result;
}
