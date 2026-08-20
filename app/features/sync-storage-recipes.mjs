const ORIGIN_LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ACCOUNT_ID = /^[0-9a-f]{32}$/i;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const REGION = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const SYNC_STORAGE_RECIPES = Object.freeze([
  Object.freeze({
    id: "http-gateway",
    label: "HTTP 网关",
    shortLabel: "Bearer / 无认证",
    authType: "bearer",
    region: "",
    endpointPattern: "https://storage.example/evolve-sync.json",
    credentialHint: "可选 Bearer 令牌；网关必须原样透传强 ETag 与条件请求",
  }),
  Object.freeze({
    id: "cloudflare-r2",
    label: "Cloudflare R2",
    shortLabel: "S3 API · region auto",
    authType: "aws-sigv4",
    region: "auto",
    endpointPattern: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>/<OBJECT_KEY>",
    credentialHint: "优先使用限定单桶、单对象路径的短期凭据与 Session Token",
  }),
  Object.freeze({
    id: "amazon-s3",
    label: "Amazon S3",
    shortLabel: "S3 API · SigV4",
    authType: "aws-sigv4",
    region: "us-east-1",
    endpointPattern: "https://<BUCKET>.s3.<REGION>.amazonaws.com/<OBJECT_KEY>",
    credentialHint: "优先使用 STS/Cognito 下发的短期、最小权限凭据",
  }),
]);

function objectKey(value) {
  const key = String(value || "").trim().replace(/^\/+/, "");
  if (!key || key.length > 1_024 || /[\u0000-\u001f\u007f]/.test(key)) throw new Error("同步对象 Key 无效");
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function bucketName(value) {
  const bucket = String(value || "").trim().toLowerCase();
  if (!BUCKET.test(bucket)) throw new Error("存储桶名称必须为 3–63 位小写字母、数字或连字符");
  return bucket;
}

function regionName(value) {
  const region = String(value || "").trim().toLowerCase();
  if (!REGION.test(region)) throw new Error("S3 区域格式无效");
  return region;
}

export function getSyncStorageRecipe(idValue) {
  const id = String(idValue || "");
  const recipe = SYNC_STORAGE_RECIPES.find((candidate) => candidate.id === id);
  if (!recipe) throw new Error("远端存储连接配方不受支持");
  return recipe;
}

export function buildSyncStorageObjectUrl(recipeId, value = {}) {
  const recipe = getSyncStorageRecipe(recipeId);
  if (recipe.id === "http-gateway") return String(value.objectUrl || "").trim();
  const bucket = bucketName(value.bucket);
  const key = objectKey(value.objectKey);
  if (recipe.id === "cloudflare-r2") {
    const accountId = String(value.accountId || "").trim().toLowerCase();
    if (!ACCOUNT_ID.test(accountId)) throw new Error("R2 Account ID 必须为 32 位十六进制字符串");
    return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
  }
  const region = regionName(value.region || recipe.region);
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export function createSyncStorageCorsPolicy(originValue) {
  let url;
  try {
    url = new URL(String(originValue || ""));
  } catch {
    throw new Error("工作台 Origin 无效");
  }
  const loopback = ORIGIN_LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("工作台 Origin 必须使用 HTTPS；只有本机回环地址可以使用 HTTP");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("工作台 Origin 不能包含路径、凭据、查询或片段");
  return [{
    AllowedOrigins: [url.origin],
    AllowedMethods: ["GET", "PUT"],
    AllowedHeaders: ["Authorization", "Content-Type", "If-Match", "If-None-Match", "x-amz-content-sha256", "x-amz-date", "x-amz-security-token"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  }];
}
