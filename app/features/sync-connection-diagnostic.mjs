import { inspectAwsCredentialLifecycle } from "./aws-sigv4.mjs";
import { normalizeRemoteTransportConfig } from "./sync-remote-transport.mjs";
import { getSyncStorageRecipe } from "./sync-storage-recipes.mjs";

export const SYNC_CONNECTION_DIAGNOSTIC_FORMAT = "evolve-desk-sync-connection-diagnostic";
export const SYNC_CONNECTION_DIAGNOSTIC_VERSION = 1;
export const MAX_SYNC_CONNECTION_DIAGNOSTIC_BYTES = 64 * 1_024;

const DIGEST = /^[0-9a-f]{64}$/;
const LIFECYCLES = new Set(["long-lived", "unknown", "valid", "expiring", "expired"]);
const SOURCES = new Set(["none", "manual", "broker"]);
const PROBE_STATES = new Set(["not-checked", "empty", "etag-ready", "read-only", "error"]);
const FAILURE_CODES = new Set(["", "access-denied", "network-or-cors", "invalid-object", "conditional-conflict", "unknown"]);
const REGION = /^[a-z0-9][a-z0-9-]{1,31}$/;

function requireCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持连接诊断所需的 Web Crypto");
  return globalThis.crypto;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function hex(value) {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function digest(value) {
  return hex(await requireCrypto().subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`${label}包含缺失或未声明字段`);
}

function isoTimestamp(value, label, optional = false) {
  if (optional && !value) return "";
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) throw new Error(`${label}无效`);
  const normalized = new Date(value).toISOString();
  if (normalized !== value) throw new Error(`${label}必须使用标准 UTC ISO 时间`);
  return value;
}

function digestField(value, label, optional = false) {
  if (optional && value === "") return "";
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error(`${label}无效`);
  return value;
}

function probeState(value = {}) {
  const checkedAt = value.checkedAt ? new Date(value.checkedAt).toISOString() : "";
  const status = String(value.status || "not-checked");
  const failureCode = String(value.failureCode || "");
  if (!PROBE_STATES.has(status) || !FAILURE_CODES.has(failureCode)) throw new Error("远端探测状态无效");
  if (status === "error" && !failureCode) throw new Error("远端探测失败必须包含脱敏错误分类");
  if (status !== "error" && failureCode) throw new Error("成功的远端探测不能包含错误分类");
  return {
    status,
    checkedAt,
    revisionDigest: value.revisionId ? value.revisionId : "",
    validatorDigest: value.validator ? value.validator : "",
    failureCode,
  };
}

export async function createSyncConnectionDiagnostic(value, nowValue = new Date()) {
  const recipe = getSyncStorageRecipe(value?.recipeId);
  const objectUrl = normalizeRemoteTransportConfig({ objectUrl: value?.objectUrl }).objectUrl;
  const url = new URL(objectUrl);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw new Error("连接诊断时间无效");
  const lifecycle = recipe.authType === "aws-sigv4"
    ? inspectAwsCredentialLifecycle({ sessionToken: value?.sessionToken, expiresAt: value?.expiresAt }, now)
    : { status: "long-lived", expiresAt: "" };
  const source = recipe.authType === "aws-sigv4" ? String(value?.credentialSource || "manual") : "none";
  if (!SOURCES.has(source)) throw new Error("凭据来源无效");
  const probe = probeState(value?.probe);
  const body = {
    format: SYNC_CONNECTION_DIAGNOSTIC_FORMAT,
    version: SYNC_CONNECTION_DIAGNOSTIC_VERSION,
    createdAt: now.toISOString(),
    recipe: {
      id: recipe.id,
      authType: recipe.authType,
      region: recipe.authType === "aws-sigv4" ? String(value?.region || recipe.region).trim().toLowerCase() : "",
    },
    target: {
      endpointDigest: await digest(url.origin),
      objectDigest: await digest(objectUrl),
    },
    credential: {
      source,
      lifecycle: lifecycle.status,
      expiresAt: lifecycle.expiresAt,
      hasSessionToken: Boolean(value?.sessionToken),
      accessKeyDigest: value?.accessKeyId ? await digest(String(value.accessKeyId).trim()) : "",
    },
    probe: {
      ...probe,
      revisionDigest: probe.revisionDigest ? await digest(probe.revisionDigest) : "",
      validatorDigest: probe.validatorDigest ? await digest(probe.validatorDigest) : "",
    },
    contract: {
      read: "GET",
      write: "PUT",
      firstWrite: "If-None-Match: *",
      nextWrite: "If-Match: strong ETag",
      responseEvidence: "Expose ETag",
    },
  };
  return { body, digest: await digest(canonicalJson(body)) };
}

export function serializeSyncConnectionDiagnostic(diagnostic) {
  return `${JSON.stringify(diagnostic, null, 2)}\n`;
}

export async function inspectSyncConnectionDiagnosticText(rawValue) {
  const raw = String(rawValue || "");
  if (byteLength(raw) > MAX_SYNC_CONNECTION_DIAGNOSTIC_BYTES) throw new Error("连接诊断摘要超过 64 KiB 上限");
  let diagnostic;
  try {
    diagnostic = JSON.parse(raw);
  } catch {
    throw new Error("连接诊断摘要不是有效 JSON");
  }
  exactKeys(diagnostic, ["body", "digest"], "连接诊断摘要");
  exactKeys(diagnostic.body, ["format", "version", "createdAt", "recipe", "target", "credential", "probe", "contract"], "连接诊断正文");
  exactKeys(diagnostic.body.recipe, ["id", "authType", "region"], "连接配方证据");
  exactKeys(diagnostic.body.target, ["endpointDigest", "objectDigest"], "连接目标证据");
  exactKeys(diagnostic.body.credential, ["source", "lifecycle", "expiresAt", "hasSessionToken", "accessKeyDigest"], "连接凭据证据");
  exactKeys(diagnostic.body.probe, ["status", "checkedAt", "revisionDigest", "validatorDigest", "failureCode"], "连接探测证据");
  exactKeys(diagnostic.body.contract, ["read", "write", "firstWrite", "nextWrite", "responseEvidence"], "条件写入契约");
  if (diagnostic.body.format !== SYNC_CONNECTION_DIAGNOSTIC_FORMAT || diagnostic.body.version !== SYNC_CONNECTION_DIAGNOSTIC_VERSION) throw new Error("连接诊断摘要版本不受支持");
  const createdAt = isoTimestamp(diagnostic.body.createdAt, "诊断创建时间");
  const recipe = getSyncStorageRecipe(diagnostic.body.recipe.id);
  if (diagnostic.body.recipe.authType !== recipe.authType || typeof diagnostic.body.recipe.region !== "string") throw new Error("连接配方证据无效");
  if (recipe.authType === "bearer" ? diagnostic.body.recipe.region !== "" : !REGION.test(diagnostic.body.recipe.region)) throw new Error("连接配方区域证据无效");
  if (recipe.id === "cloudflare-r2" && diagnostic.body.recipe.region !== "auto") throw new Error("R2 连接配方必须使用 auto 区域");
  digestField(diagnostic.body.target.endpointDigest, "端点摘要");
  digestField(diagnostic.body.target.objectDigest, "对象摘要");
  if (!SOURCES.has(diagnostic.body.credential.source) || !LIFECYCLES.has(diagnostic.body.credential.lifecycle) || typeof diagnostic.body.credential.hasSessionToken !== "boolean") throw new Error("连接凭据证据无效");
  isoTimestamp(diagnostic.body.credential.expiresAt, "凭据到期时间", true);
  digestField(diagnostic.body.credential.accessKeyDigest, "Access Key 摘要", true);
  if (recipe.authType === "bearer") {
    if (diagnostic.body.credential.source !== "none" || diagnostic.body.credential.lifecycle !== "long-lived" || diagnostic.body.credential.expiresAt || diagnostic.body.credential.hasSessionToken || diagnostic.body.credential.accessKeyDigest) throw new Error("HTTP 配方不能携带 SigV4 凭据证据");
  } else {
    if (diagnostic.body.credential.source === "none") throw new Error("SigV4 配方缺少凭据来源");
    const expectedLifecycle = inspectAwsCredentialLifecycle({
      sessionToken: diagnostic.body.credential.hasSessionToken ? "redacted-session" : "",
      expiresAt: diagnostic.body.credential.expiresAt,
    }, createdAt);
    if (expectedLifecycle.status !== diagnostic.body.credential.lifecycle) throw new Error("凭据生命周期与诊断时间不一致");
    if (diagnostic.body.credential.source === "broker" && (!diagnostic.body.credential.hasSessionToken || !diagnostic.body.credential.expiresAt || !diagnostic.body.credential.accessKeyDigest)) throw new Error("broker 凭据证据不完整");
  }
  if (!PROBE_STATES.has(diagnostic.body.probe.status) || !FAILURE_CODES.has(diagnostic.body.probe.failureCode)) throw new Error("连接探测证据无效");
  isoTimestamp(diagnostic.body.probe.checkedAt, "远端探测时间", true);
  digestField(diagnostic.body.probe.revisionDigest, "远端版本摘要", true);
  digestField(diagnostic.body.probe.validatorDigest, "ETag 摘要", true);
  if (diagnostic.body.probe.status === "error" ? !diagnostic.body.probe.failureCode : Boolean(diagnostic.body.probe.failureCode)) throw new Error("连接探测错误分类无效");
  if (diagnostic.body.probe.status === "not-checked" ? Boolean(diagnostic.body.probe.checkedAt) : !diagnostic.body.probe.checkedAt) throw new Error("连接探测时间与状态不一致");
  if (diagnostic.body.probe.status === "etag-ready" && (!diagnostic.body.probe.revisionDigest || !diagnostic.body.probe.validatorDigest)) throw new Error("ETag 就绪证据不完整");
  if (diagnostic.body.probe.status === "read-only" && (!diagnostic.body.probe.revisionDigest || diagnostic.body.probe.validatorDigest)) throw new Error("只读连接证据不完整");
  if (["not-checked", "empty", "error"].includes(diagnostic.body.probe.status) && (diagnostic.body.probe.revisionDigest || diagnostic.body.probe.validatorDigest)) throw new Error("连接探测摘要与状态不一致");
  if (diagnostic.body.contract.read !== "GET" || diagnostic.body.contract.write !== "PUT" || diagnostic.body.contract.firstWrite !== "If-None-Match: *" || diagnostic.body.contract.nextWrite !== "If-Match: strong ETag" || diagnostic.body.contract.responseEvidence !== "Expose ETag") throw new Error("条件写入契约已改变");
  digestField(diagnostic.digest, "连接诊断封签");
  const expected = await digest(canonicalJson(diagnostic.body));
  if (expected !== diagnostic.digest) throw new Error("连接诊断摘要封签不匹配");
  return { diagnostic, digest: expected, sealed: true };
}
