import { buildSyncStorageObjectUrl, getSyncStorageRecipe, normalizeSyncStorageObjectKey } from "./sync-storage-recipes.mjs";

export const SYNC_STORAGE_SCOPE_OPERATIONS = Object.freeze(["GetObject", "PutObject"]);
export const MIN_R2_SCOPE_TTL_SECONDS = 5 * 60;
export const MIN_AWS_SCOPE_TTL_SECONDS = 15 * 60;
export const MAX_SCOPE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_AWS_SCOPE_TTL_SECONDS = 12 * 60 * 60;

function normalizeTtl(provider, value) {
  const ttlSeconds = Number(value);
  const minimum = provider === "amazon-s3" ? MIN_AWS_SCOPE_TTL_SECONDS : MIN_R2_SCOPE_TTL_SECONDS;
  const maximum = provider === "amazon-s3" ? MAX_AWS_SCOPE_TTL_SECONDS : MAX_SCOPE_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < minimum || ttlSeconds > maximum) {
    throw new Error(provider === "amazon-s3" ? "AWS STS 凭据期限必须为 900–43200 秒" : "R2 临时凭据期限必须为 300–604800 秒");
  }
  return ttlSeconds;
}

function rejectPolicyWildcards(value) {
  if (/[*?]/.test(value)) throw new Error("精确对象权限票据不能包含策略通配符 * 或 ?");
  return value;
}

function stableValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("权限票据必须是普通 JSON 对象");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function createR2LocalCredentialClaims(value) {
  const objectKey = rejectPolicyWildcards(normalizeSyncStorageObjectKey(value?.objectKey));
  const bucket = String(value?.bucket || "").trim().toLowerCase();
  buildSyncStorageObjectUrl("cloudflare-r2", { accountId: value?.accountId, bucket, objectKey });
  return {
    bucket,
    scope: "object-read-write",
    actions: [...SYNC_STORAGE_SCOPE_OPERATIONS],
    paths: { prefixPaths: [], objectPaths: [objectKey] },
  };
}

export function createAwsS3SessionPolicy(value) {
  const objectKey = rejectPolicyWildcards(normalizeSyncStorageObjectKey(value?.objectKey));
  if (objectKey.includes("${")) throw new Error("精确对象权限票据不能包含 IAM 策略变量");
  const bucket = String(value?.bucket || "").trim().toLowerCase();
  const region = String(value?.region || "").trim().toLowerCase();
  buildSyncStorageObjectUrl("amazon-s3", { bucket, objectKey, region });
  return {
    Version: "2012-10-17",
    Statement: [{
      Sid: "EvolveDeskExactObject",
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject"],
      Resource: `arn:aws:s3:::${bucket}/${objectKey}`,
    }],
  };
}

export function createSyncStorageScopeTicket(providerValue, value = {}) {
  const recipe = getSyncStorageRecipe(providerValue);
  if (recipe.authType !== "aws-sigv4") throw new Error("当前连接配方不使用 SigV4 权限票据");
  const provider = recipe.id;
  const objectKey = rejectPolicyWildcards(normalizeSyncStorageObjectKey(value.objectKey));
  const bucket = String(value.bucket || "").trim().toLowerCase();
  const accountId = provider === "cloudflare-r2" ? String(value.accountId || "").trim().toLowerCase() : undefined;
  const region = provider === "cloudflare-r2" ? "auto" : String(value.region || "").trim().toLowerCase();
  buildSyncStorageObjectUrl(provider, { accountId, bucket, objectKey, region });
  const target = {
    ...(provider === "cloudflare-r2" ? { accountId } : {}),
    bucket,
    objectKey,
    region,
  };
  return {
    format: "evolve-desk-storage-scope-ticket",
    version: 1,
    provider,
    target,
    operations: [...SYNC_STORAGE_SCOPE_OPERATIONS],
    ttlSeconds: normalizeTtl(provider, value.ttlSeconds),
    providerPolicy: provider === "cloudflare-r2"
      ? createR2LocalCredentialClaims(target)
      : createAwsS3SessionPolicy(target),
  };
}

export function inspectSyncStorageScopeTicket(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("权限票据格式无效");
  if (value.format !== "evolve-desk-storage-scope-ticket" || value.version !== 1) throw new Error("权限票据版本不受支持");
  const target = value.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error("权限票据目标无效");
  const expected = createSyncStorageScopeTicket(value.provider, {
    accountId: target.accountId,
    bucket: target.bucket,
    objectKey: target.objectKey,
    region: target.region,
    ttlSeconds: value.ttlSeconds,
  });
  if (stableJson(value) !== stableJson(expected)) throw new Error("权限票据与当前单对象 GET/PUT 最小权限规范不等价");
  return expected;
}

export function serializeSyncStorageScopeTicket(value) {
  return `${JSON.stringify(inspectSyncStorageScopeTicket(value), null, 2)}\n`;
}
