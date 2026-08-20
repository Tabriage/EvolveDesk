import { createHash, createHmac, randomUUID } from "node:crypto";
import { createAwsSigV4Headers, normalizeAwsSigV4Credentials } from "../app/features/aws-sigv4.mjs";
import { inspectCredentialBrokerRequest, MAX_CREDENTIAL_BROKER_RESPONSE_BYTES } from "../app/features/sync-credential-broker.mjs";
import { createAwsS3SessionPolicy, createR2LocalCredentialClaims } from "../app/features/sync-storage-scope.mjs";

const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9_+=,.@\/-]{1,512}$/;
const ROLE_SESSION_NAME = /^[A-Za-z0-9_+=,.@-]{2,64}$/;

function text(value, label, maximum = 8_192, minimum = 1) {
  const candidate = String(value || "").trim();
  if (candidate.length < minimum || candidate.length > maximum || /[\u0000-\u001f\u007f]/.test(candidate)) throw new Error(`${label}配置无效`);
  return candidate;
}

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("凭据签发时间无效");
  return date;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function validateR2IssuerConfig(configValue) {
  const accountId = text(configValue?.accountId, "R2 Account ID", 32, 32).toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error("R2 Account ID 配置无效");
  return {
    accountId,
    accessKeyId: text(configValue?.accessKeyId, "R2 Access Key ID", 128, 8),
    secretAccessKey: text(configValue?.secretAccessKey, "R2 Secret Access Key", 256, 8),
  };
}

export function validateAwsIssuerConfig(configValue) {
  const roleArn = text(configValue?.roleArn, "AWS Role ARN", 600);
  if (!ROLE_ARN.test(roleArn)) throw new Error("AWS Role ARN 配置无效");
  const region = String(configValue?.region || "").trim().toLowerCase();
  const parent = normalizeAwsSigV4Credentials({
    accessKeyId: configValue?.accessKeyId,
    secretAccessKey: configValue?.secretAccessKey,
    sessionToken: configValue?.sessionToken,
    expiresAt: configValue?.expiresAt,
    region: region || "us-east-1",
  });
  const sessionName = configValue?.sessionName ? String(configValue.sessionName) : "";
  if (sessionName && !ROLE_SESSION_NAME.test(sessionName)) throw new Error("AWS Role Session Name 配置无效");
  const externalId = configValue?.externalId ? text(configValue.externalId, "AWS External ID", 1_224, 2) : "";
  return {
    roleArn,
    allowedRegion: region,
    sessionName,
    externalId,
    accessKeyId: parent.accessKeyId,
    secretAccessKey: parent.secretAccessKey,
    sessionToken: parent.sessionToken,
    expiresAt: parent.expiresAt,
  };
}

export function issueR2TemporaryCredentials(requestValue, configValue, nowValue = new Date()) {
  const request = inspectCredentialBrokerRequest(requestValue);
  if (request.provider !== "cloudflare-r2") throw new Error("R2 签发器不能处理当前供应商");
  const config = validateR2IssuerConfig(configValue);
  const { accountId, accessKeyId } = config;
  if (request.scope.accountId !== accountId) throw new Error("请求的 R2 Account ID 不在本代理授权范围内");
  const parentSecret = config.secretAccessKey;
  const now = dateValue(nowValue);
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAtSeconds = issuedAt + request.ttlSeconds;
  const claims = createR2LocalCredentialClaims(request.scope);
  const endpoint = new URL(`https://${accountId}.r2.cloudflarestorage.com`);
  const protectedHeader = base64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64urlJson({
    ...claims,
    sub: accountId,
    iss: accessKeyId,
    aud: endpoint.host,
    iat: issuedAt,
    exp: expiresAtSeconds,
  });
  const unsignedToken = `${protectedHeader}.${payload}`;
  const signature = createHmac("sha256", parentSecret).update(unsignedToken).digest("base64url");
  const signedToken = `${unsignedToken}.${signature}`;
  return {
    credentials: {
      accessKeyId,
      secretAccessKey: createHash("sha256").update(signedToken).digest("hex"),
      sessionToken: Buffer.from(`jwt/${signedToken}`, "utf8").toString("base64"),
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    },
  };
}

function xmlEntityDecode(value) {
  return value.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (match, hex, decimal, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()] || match;
  });
}

function xmlValue(xml, name, maximum = 16_384) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(xml);
  if (!match) throw new Error("AWS STS 响应缺少临时凭据字段");
  return text(xmlEntityDecode(match[1]), `AWS STS ${name}`, maximum);
}

export async function issueAwsTemporaryCredentials(requestValue, configValue, options = {}) {
  const request = inspectCredentialBrokerRequest(requestValue);
  if (request.provider !== "amazon-s3") throw new Error("AWS 签发器不能处理当前供应商");
  const config = validateAwsIssuerConfig(configValue);
  const { roleArn, allowedRegion: configuredRegion } = config;
  if (configuredRegion && request.scope.region !== configuredRegion) throw new Error("请求的 AWS Region 不在本代理授权范围内");
  const sessionName = config.sessionName || `evolve-desk-${randomUUID().slice(0, 8)}`;
  if (!ROLE_SESSION_NAME.test(sessionName)) throw new Error("AWS Role Session Name 配置无效");
  const externalId = config.externalId;
  const parentCredentials = normalizeAwsSigV4Credentials({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
    expiresAt: config.expiresAt,
    region: request.scope.region,
  });
  const endpointUrl = `https://sts.${request.scope.region}.amazonaws.com/`;
  const body = new URLSearchParams({
    Action: "AssumeRole",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    DurationSeconds: String(request.ttlSeconds),
    Policy: JSON.stringify(createAwsS3SessionPolicy(request.scope)),
    ...(externalId ? { ExternalId: externalId } : {}),
  }).toString();
  const now = dateValue(options.now || new Date());
  const headers = await createAwsSigV4Headers(parentCredentials, {
    method: "POST",
    service: "sts",
    url: endpointUrl,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  }, now);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持访问 AWS STS");
  let response;
  try {
    response = await fetchImpl(endpointUrl, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new Error("无法访问 AWS STS");
  }
  if (response.status !== 200) throw new Error(`AWS STS 返回 HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("AWS STS 响应超过 64 KiB 上限");
  const xml = await response.text();
  if (Buffer.byteLength(xml, "utf8") > MAX_CREDENTIAL_BROKER_RESPONSE_BYTES) throw new Error("AWS STS 响应超过 64 KiB 上限");
  const credentials = normalizeAwsSigV4Credentials({
    accessKeyId: xmlValue(xml, "AccessKeyId", 128),
    secretAccessKey: xmlValue(xml, "SecretAccessKey", 256),
    sessionToken: xmlValue(xml, "SessionToken", 16_384),
    expiresAt: xmlValue(xml, "Expiration", 64),
    region: request.scope.region,
  });
  return { credentials: {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    expiresAt: credentials.expiresAt,
  } };
}
