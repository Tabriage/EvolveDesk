import { sha256Text } from "./backup-core.mjs";
import { MAX_EXTERNAL_MEDIA_BYTES } from "./external-media-hash.mjs";
import { createExternalMediaDuplicateReport } from "./external-media-store.mjs";

export const MAX_EXTERNAL_MEDIA_DUPLICATE_AUDIT_BYTES = 64 * 1024;
const AUDIT_FORMAT = "evolve-desk.external-media-duplicate-audit";
const AUDIT_FORMAT_VERSION = 1;
const MAX_INDEX_RECORDS = 256;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^local-media:\/\/[A-Za-z0-9._~-]{8,200}$/;

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}不是有效对象`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label}包含缺失或未声明字段`);
}

function canonicalIsoDate(value, label) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString() !== value) throw new Error(`${label}无效`);
  return value;
}

function integer(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label}无效`);
  return value;
}

function normalizeBasis(value) {
  exactKeys(value, ["match", "fullHashRequired", "deletionPolicy"], "重复审计判定依据");
  if (value.match !== "size+full-sha256" || value.fullHashRequired !== true || value.deletionPolicy !== "none") throw new Error("重复审计判定依据不受支持");
  return { match: "size+full-sha256", fullHashRequired: true, deletionPolicy: "none" };
}

function normalizeSummary(value) {
  exactKeys(value, ["indexedRecords", "completeHashRecords", "duplicateGroups", "duplicateRecords", "duplicateBytes"], "重复审计统计");
  const summary = {
    indexedRecords: integer(value.indexedRecords, MAX_INDEX_RECORDS, "重复审计索引数量"),
    completeHashRecords: integer(value.completeHashRecords, MAX_INDEX_RECORDS, "重复审计完整哈希数量"),
    duplicateGroups: integer(value.duplicateGroups, Math.floor(MAX_INDEX_RECORDS / 2), "重复审计重复组数量"),
    duplicateRecords: integer(value.duplicateRecords, MAX_INDEX_RECORDS, "重复审计组内记录数量"),
    duplicateBytes: integer(value.duplicateBytes, MAX_EXTERNAL_MEDIA_BYTES * MAX_INDEX_RECORDS, "重复审计组内字节数量"),
  };
  if (summary.completeHashRecords > summary.indexedRecords || summary.duplicateRecords > summary.completeHashRecords) throw new Error("重复审计统计数量关系无效");
  if (summary.duplicateGroups > Math.floor(summary.duplicateRecords / 2)) throw new Error("重复审计组数量与组内记录不一致");
  if (summary.duplicateGroups === 0 && (summary.duplicateRecords !== 0 || summary.duplicateBytes !== 0)) throw new Error("重复审计空报告统计不一致");
  if (summary.duplicateGroups > 0 && (summary.duplicateRecords < summary.duplicateGroups * 2 || summary.duplicateBytes < summary.duplicateRecords)) throw new Error("重复审计重复组统计不一致");
  return summary;
}

function normalizeManifest(value, duplicateGroups) {
  exactKeys(value, ["algorithm", "groupSetDigest", "groupCount"], "重复审计组集合封签");
  if (value.algorithm !== "SHA-256" || !SHA256.test(String(value.groupSetDigest || ""))) throw new Error("重复审计组集合封签无效");
  const groupCount = integer(value.groupCount, Math.floor(MAX_INDEX_RECORDS / 2), "重复审计封签组数量");
  if (groupCount !== duplicateGroups) throw new Error("重复审计封签组数量不一致");
  return { algorithm: "SHA-256", groupSetDigest: value.groupSetDigest, groupCount };
}

function indexedRecordCount(records) {
  const seen = new Set();
  for (const record of records) {
    const sourceKey = String(record?.sourceKey || "");
    const name = String(record?.name || "").trim();
    const size = Number(record?.size);
    if (!SOURCE_KEY.test(sourceKey) || seen.has(sourceKey) || !name || !Number.isSafeInteger(size) || size < 1 || size > MAX_EXTERNAL_MEDIA_BYTES) continue;
    seen.add(sourceKey);
  }
  return seen.size;
}

async function duplicateSnapshot(recordsValue, requireCompleteHash) {
  const records = Array.isArray(recordsValue) ? recordsValue : [];
  if (records.length > MAX_INDEX_RECORDS) throw new Error("一次最多审计 256 条外部媒体索引");
  const report = createExternalMediaDuplicateReport(records);
  if (requireCompleteHash && report.hashedRecords < 1) throw new Error("至少需要一条已完成完整 SHA-256 的外部媒体索引");
  const groupManifest = report.groups.map((group) => ({
    size: group.size,
    fullHash: group.fullHash,
    copyCount: group.records.length,
  }));
  return {
    basis: { match: "size+full-sha256", fullHashRequired: true, deletionPolicy: "none" },
    summary: {
      indexedRecords: indexedRecordCount(records),
      completeHashRecords: report.hashedRecords,
      duplicateGroups: report.groups.length,
      duplicateRecords: report.duplicateRecords,
      duplicateBytes: report.groups.reduce((total, group) => total + group.size * group.records.length, 0),
    },
    manifest: {
      algorithm: "SHA-256",
      groupSetDigest: await sha256Text(JSON.stringify(groupManifest)),
      groupCount: report.groups.length,
    },
  };
}

function auditContent(value) {
  return {
    format: AUDIT_FORMAT,
    formatVersion: AUDIT_FORMAT_VERSION,
    createdAt: value.createdAt,
    basis: value.basis,
    summary: value.summary,
    manifest: value.manifest,
  };
}

async function normalizeAuditReceipt(value) {
  exactKeys(value, ["format", "formatVersion", "auditId", "createdAt", "basis", "summary", "manifest", "integrity"], "外部媒体重复审计摘要");
  if (value.format !== AUDIT_FORMAT || value.formatVersion !== AUDIT_FORMAT_VERSION) throw new Error("外部媒体重复审计摘要格式不受支持");
  const summary = normalizeSummary(value.summary);
  const content = auditContent({
    createdAt: canonicalIsoDate(value.createdAt, "重复审计摘要时间"),
    basis: normalizeBasis(value.basis),
    summary,
    manifest: normalizeManifest(value.manifest, summary.duplicateGroups),
  });
  exactKeys(value.integrity, ["algorithm", "digest"], "重复审计完整性封签");
  if (value.integrity.algorithm !== "SHA-256" || !SHA256.test(String(value.integrity.digest || ""))) throw new Error("重复审计完整性封签无效");
  const digest = await sha256Text(JSON.stringify(content));
  const auditId = `media_duplicate_audit_${digest.slice(0, 32)}`;
  if (value.integrity.digest !== digest || value.auditId !== auditId) throw new Error("重复审计完整性封签不一致，文件可能已被修改");
  return { ...content, auditId, integrity: { algorithm: "SHA-256", digest } };
}

export async function createExternalMediaDuplicateAudit(records, createdAtValue = new Date().toISOString()) {
  const snapshot = await duplicateSnapshot(records, true);
  const content = auditContent({
    createdAt: canonicalIsoDate(new Date(createdAtValue).toISOString(), "重复审计摘要时间"),
    ...snapshot,
  });
  const digest = await sha256Text(JSON.stringify(content));
  return { ...content, auditId: `media_duplicate_audit_${digest.slice(0, 32)}`, integrity: { algorithm: "SHA-256", digest } };
}

export function serializeExternalMediaDuplicateAudit(receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (byteLength(serialized) > MAX_EXTERNAL_MEDIA_DUPLICATE_AUDIT_BYTES) throw new Error("外部媒体重复审计摘要超过 64 KiB 上限");
  return serialized;
}

export async function inspectExternalMediaDuplicateAuditText(raw) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_EXTERNAL_MEDIA_DUPLICATE_AUDIT_BYTES) throw new Error("外部媒体重复审计摘要为空或超过 64 KiB 上限");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("外部媒体重复审计摘要不是有效 JSON");
  }
  const receipt = await normalizeAuditReceipt(value);
  return {
    receipt,
    digest: receipt.integrity.digest,
    hasDuplicates: receipt.summary.duplicateGroups > 0,
    contentIdentifiersDisclosed: false,
  };
}

export async function compareExternalMediaDuplicateAuditToIndex(receiptValue, records) {
  const receipt = await normalizeAuditReceipt(receiptValue);
  const local = await duplicateSnapshot(records, false);
  const reasons = [];
  const labels = {
    indexedRecords: "索引数量",
    completeHashRecords: "完整哈希数量",
    duplicateGroups: "重复组数量",
    duplicateRecords: "组内记录数量",
    duplicateBytes: "组内字节数量",
  };
  for (const [key, label] of Object.entries(labels)) {
    if (receipt.summary[key] !== local.summary[key]) reasons.push(`${label}与本机报告不一致`);
  }
  const manifestMatches = receipt.manifest.groupSetDigest === local.manifest.groupSetDigest && receipt.manifest.groupCount === local.manifest.groupCount;
  if (!manifestMatches) reasons.push("重复内容组集合与本机报告不一致");
  return {
    matches: reasons.length === 0,
    manifestMatches,
    summaryMatches: reasons.every((reason) => reason === "重复内容组集合与本机报告不一致"),
    reasons,
    localSummary: local.summary,
  };
}
