import { sha256Text } from "./backup-core.mjs";

export const RECOVERY_MAINTENANCE_RECORD_VERSION = 1;
export const RECOVERY_DRILL_INTERVAL_DAYS = 90;
export const RECOVERY_REPLACEMENT_REVIEW_DAYS = 180;
export const MAX_RECOVERY_MAINTENANCE_AUDIT_BYTES = 128 * 1024;

const DAY_MS = 24 * 60 * 60 * 1_000;
const SAFE_ID = /^[A-Za-z0-9_-]{8,100}$/;
const HASH = /^[0-9a-f]{64}$/;
const CONFIRMATION_IDS = new Set(["separate-storage", "retire-old-copies"]);
const AUDIT_FORMAT = "evolve-desk.recovery-maintenance-audit";
const AUDIT_FORMAT_VERSION = 1;
const RECORD_KEYS = ["recordVersion", "channelId", "generation", "recoveryId", "ownerFingerprint", "kitCreatedAt", "kitBoundRevisionId", "securityProfileHash", "authorizedDeviceCount", "revokedDeviceCount", "trackedAt", "previousRecoveryId", "separateStorageConfirmedAt", "oldCopiesRetiredAt", "lastDrill"];
const DRILL_KEYS = ["drilledAt", "packetRevisionId", "packetCreatedAt", "packetAuthorFingerprint", "workspaceVersion", "securityProfileHash"];

function text(value, limit = 100) {
  return String(value || "").trim().slice(0, limit);
}

function isoDate(value, allowEmpty = false) {
  const candidate = text(value, 40);
  if (!candidate && allowEmpty) return "";
  if (!candidate || !Number.isFinite(new Date(candidate).getTime())) throw new Error("恢复维护回执包含无效时间");
  return new Date(candidate).toISOString();
}

function safeId(value, label, allowEmpty = false) {
  const candidate = text(value, 100);
  if (!candidate && allowEmpty) return "";
  if (!SAFE_ID.test(candidate)) throw new Error(`${label}无效`);
  return candidate;
}

function hash(value, label) {
  const candidate = text(value, 64).toLowerCase();
  if (!HASH.test(candidate)) throw new Error(`${label}无效`);
  return candidate;
}

function boundedCount(value, label, minimum = 0) {
  const candidate = Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > 64) throw new Error(`${label}无效`);
  return candidate;
}

function positiveVersion(value) {
  const candidate = Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate >= 1_000_000) throw new Error("恢复演练工作台版本无效");
  return candidate;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}不是有效对象`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label}包含缺失或未声明字段`);
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function canonicalIsoDate(value, label) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString() !== value) throw new Error(`${label}无效`);
  return value;
}

function normalizeDrill(value) {
  if (!value) return null;
  return {
    drilledAt: isoDate(value.drilledAt),
    packetRevisionId: safeId(value.packetRevisionId, "恢复演练同步版本"),
    packetCreatedAt: isoDate(value.packetCreatedAt),
    packetAuthorFingerprint: hash(value.packetAuthorFingerprint, "恢复演练同步包作者指纹"),
    workspaceVersion: positiveVersion(value.workspaceVersion),
    securityProfileHash: hash(value.securityProfileHash, "恢复演练授权清单摘要"),
  };
}

export function normalizeSyncRecoveryMaintenanceRecord(value) {
  if (!value || typeof value !== "object" || value.recordVersion !== RECOVERY_MAINTENANCE_RECORD_VERSION) throw new Error("恢复维护回执版本不受支持");
  const generation = Number(value.generation);
  if (!Number.isSafeInteger(generation) || generation < 1 || generation >= 999_999) throw new Error("恢复维护回执的空间世代无效");
  const record = {
    recordVersion: RECOVERY_MAINTENANCE_RECORD_VERSION,
    channelId: safeId(value.channelId, "恢复维护空间标识"),
    generation,
    recoveryId: safeId(value.recoveryId, "恢复材料标识"),
    ownerFingerprint: hash(value.ownerFingerprint, "恢复材料所有者指纹"),
    kitCreatedAt: isoDate(value.kitCreatedAt),
    kitBoundRevisionId: safeId(value.kitBoundRevisionId, "恢复材料绑定版本", true),
    securityProfileHash: hash(value.securityProfileHash, "恢复材料授权清单摘要"),
    authorizedDeviceCount: boundedCount(value.authorizedDeviceCount, "恢复材料授权设备数量", 1),
    revokedDeviceCount: boundedCount(value.revokedDeviceCount, "恢复材料撤销设备数量"),
    trackedAt: isoDate(value.trackedAt),
    previousRecoveryId: safeId(value.previousRecoveryId, "被替换恢复材料标识", true),
    separateStorageConfirmedAt: isoDate(value.separateStorageConfirmedAt, true),
    oldCopiesRetiredAt: isoDate(value.oldCopiesRetiredAt, true),
    lastDrill: normalizeDrill(value.lastDrill),
  };
  if (new Date(record.trackedAt).getTime() < new Date(record.kitCreatedAt).getTime()) throw new Error("恢复维护回执早于恢复材料创建时间");
  if (record.previousRecoveryId === record.recoveryId) throw new Error("恢复材料不能替换自身");
  if (record.lastDrill && (new Date(record.lastDrill.drilledAt).getTime() < new Date(record.kitCreatedAt).getTime() || new Date(record.lastDrill.packetCreatedAt).getTime() > new Date(record.lastDrill.drilledAt).getTime())) throw new Error("恢复维护回执的演练时间线无效");
  if ([record.separateStorageConfirmedAt, record.oldCopiesRetiredAt].some((value) => value && new Date(value).getTime() < new Date(record.trackedAt).getTime())) throw new Error("恢复维护确认早于材料登记时间");
  return record;
}

function strictSyncRecoveryMaintenanceRecord(value) {
  exactKeys(value, RECORD_KEYS, "恢复维护审计记录");
  if (value.lastDrill !== null) exactKeys(value.lastDrill, DRILL_KEYS, "恢复维护审计演练");
  const normalized = normalizeSyncRecoveryMaintenanceRecord(value);
  for (const key of RECORD_KEYS) {
    if (key === "lastDrill") continue;
    if (value[key] !== normalized[key]) throw new Error("恢复维护审计记录包含非规范字段值");
  }
  if (value.lastDrill !== null) {
    for (const key of DRILL_KEYS) if (value.lastDrill[key] !== normalized.lastDrill[key]) throw new Error("恢复维护审计演练包含非规范字段值");
  }
  return normalized;
}

function auditContent(value) {
  return { format: AUDIT_FORMAT, formatVersion: AUDIT_FORMAT_VERSION, createdAt: value.createdAt, record: value.record };
}

export async function createSyncRecoveryMaintenanceAudit(recordValue, createdAtValue = new Date().toISOString()) {
  const record = normalizeSyncRecoveryMaintenanceRecord(recordValue);
  const content = auditContent({ createdAt: canonicalIsoDate(new Date(createdAtValue).toISOString(), "恢复维护审计时间"), record });
  const digest = await sha256Text(JSON.stringify(content));
  return { ...content, receiptId: `recovery_audit_${digest.slice(0, 32)}`, integrity: { algorithm: "SHA-256", digest } };
}

export function serializeSyncRecoveryMaintenanceAudit(receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (byteLength(serialized) > MAX_RECOVERY_MAINTENANCE_AUDIT_BYTES) throw new Error("恢复维护审计摘要超过 128 KiB 上限");
  return serialized;
}

export async function inspectSyncRecoveryMaintenanceAuditText(raw) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_RECOVERY_MAINTENANCE_AUDIT_BYTES) throw new Error("恢复维护审计摘要为空或超过 128 KiB 上限");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("恢复维护审计摘要不是有效的 JSON 文件");
  }
  exactKeys(value, ["format", "formatVersion", "receiptId", "createdAt", "record", "integrity"], "恢复维护审计摘要");
  if (value.format !== AUDIT_FORMAT || value.formatVersion !== AUDIT_FORMAT_VERSION) throw new Error("这不是受支持的 Evolve Desk 恢复维护审计摘要");
  if (!/^recovery_audit_[0-9a-f]{32}$/.test(String(value.receiptId || ""))) throw new Error("恢复维护审计回执标识无效");
  exactKeys(value.integrity, ["algorithm", "digest"], "恢复维护审计完整性封签");
  if (value.integrity.algorithm !== "SHA-256" || !HASH.test(String(value.integrity.digest || ""))) throw new Error("恢复维护审计完整性封签无效");
  const content = auditContent({ createdAt: canonicalIsoDate(value.createdAt, "恢复维护审计时间"), record: strictSyncRecoveryMaintenanceRecord(value.record) });
  const digest = await sha256Text(JSON.stringify(content));
  if (digest !== value.integrity.digest || value.receiptId !== `recovery_audit_${digest.slice(0, 32)}`) throw new Error("恢复维护审计完整性封签不一致，文件可能已被修改");
  return {
    receipt: { ...content, receiptId: value.receiptId, integrity: { algorithm: "SHA-256", digest } },
    digest,
    nextDrillAt: content.record.lastDrill ? addDays(content.record.lastDrill.drilledAt, RECOVERY_DRILL_INTERVAL_DAYS) : "",
    replacementReviewAt: addDays(content.record.kitCreatedAt, RECOVERY_REPLACEMENT_REVIEW_DAYS),
    hasDrill: Boolean(content.record.lastDrill),
    separateStorageConfirmed: Boolean(content.record.separateStorageConfirmedAt),
    oldCopiesRetired: !content.record.previousRecoveryId || Boolean(content.record.oldCopiesRetiredAt),
  };
}

export function compareSyncRecoveryMaintenanceAuditToRecord(receipt, recordValue) {
  const record = normalizeSyncRecoveryMaintenanceRecord(recordValue);
  const reasons = [];
  if (receipt?.record?.channelId !== record.channelId) reasons.push("同步空间标识与本机维护回执不一致");
  if (receipt?.record?.generation !== record.generation) reasons.push("同步空间世代与本机维护回执不一致");
  if (receipt?.record?.recoveryId !== record.recoveryId) reasons.push("恢复材料标识与本机维护回执不一致");
  if (!reasons.length && JSON.stringify(receipt.record) !== JSON.stringify(record)) reasons.push("维护确认、演练版本或时间与本机回执不一致");
  return { matches: reasons.length === 0, reasons };
}

export async function createSyncRecoverySecurityProfile(value) {
  const devices = (Array.isArray(value?.authorizedDevices) ? value.authorizedDevices : []).map((device) => {
    const deviceId = safeId(device?.deviceId, "授权设备标识");
    const fingerprint = hash(device?.fingerprint, "授权设备指纹");
    return `${deviceId}:${fingerprint}`;
  }).sort();
  if (!devices.length || devices.length > 64 || new Set(devices.map((item) => item.split(":")[0])).size !== devices.length) throw new Error("恢复材料授权设备清单无效");
  const revoked = [...new Set((Array.isArray(value?.revokedDeviceIds) ? value.revokedDeviceIds : []).map((item) => safeId(item, "撤销设备标识")))].sort();
  if (revoked.length > 64) throw new Error("恢复材料撤销设备清单无效");
  return {
    hash: await sha256Text(JSON.stringify({ devices, revoked })),
    authorizedDeviceCount: devices.length,
    revokedDeviceCount: revoked.length,
  };
}

export function createSyncRecoveryMaintenanceRecord(channel, recovery, profileValue, trackedAtValue = new Date().toISOString(), previousValue = null) {
  const delegation = recovery?.delegation;
  const profile = {
    hash: hash(profileValue?.hash, "恢复材料授权清单摘要"),
    authorizedDeviceCount: boundedCount(profileValue?.authorizedDeviceCount, "恢复材料授权设备数量", 1),
    revokedDeviceCount: boundedCount(profileValue?.revokedDeviceCount, "恢复材料撤销设备数量"),
  };
  const channelId = safeId(channel?.channelId, "同步空间标识");
  const generation = Number(channel?.generation);
  const owner = (Array.isArray(channel?.authorizedDevices) ? channel.authorizedDevices : []).find((device) => device.deviceId === channel.ownerDeviceId);
  if (channel?.role !== "owner" || channel?.retiredAt || !owner) throw new Error("只有当前活跃空间的创建设备可以登记恢复维护回执");
  if (!delegation || delegation.channel?.channelId !== channelId || delegation.channel?.generation !== generation) throw new Error("恢复材料不属于当前同步空间世代");
  if (delegation.owner?.deviceId !== channel.ownerDeviceId || delegation.owner?.fingerprint !== owner.fingerprint) throw new Error("恢复材料的所有者与当前同步空间不一致");
  const previous = previousValue ? normalizeSyncRecoveryMaintenanceRecord(previousValue) : null;
  if (previous && (previous.channelId !== channelId || previous.generation !== generation)) throw new Error("不能用其他空间世代的回执登记材料替换");
  const sameRecovery = previous?.recoveryId === delegation.recoveryId;
  return normalizeSyncRecoveryMaintenanceRecord({
    recordVersion: RECOVERY_MAINTENANCE_RECORD_VERSION,
    channelId,
    generation,
    recoveryId: delegation.recoveryId,
    ownerFingerprint: delegation.owner.fingerprint,
    kitCreatedAt: delegation.createdAt,
    kitBoundRevisionId: delegation.channel.headRevisionId || "",
    securityProfileHash: profile.hash,
    authorizedDeviceCount: profile.authorizedDeviceCount,
    revokedDeviceCount: profile.revokedDeviceCount,
    trackedAt: sameRecovery ? previous.trackedAt : trackedAtValue,
    previousRecoveryId: sameRecovery ? previous.previousRecoveryId : previous?.recoveryId || "",
    separateStorageConfirmedAt: sameRecovery ? previous.separateStorageConfirmedAt : "",
    oldCopiesRetiredAt: sameRecovery ? previous.oldCopiesRetiredAt : "",
    lastDrill: sameRecovery ? previous.lastDrill : null,
  });
}

export function shouldTrackSyncRecoveryKit(recordValue, recovery) {
  if (!recordValue) return true;
  const record = normalizeSyncRecoveryMaintenanceRecord(recordValue);
  const recoveryId = safeId(recovery?.delegation?.recoveryId, "恢复材料标识");
  const createdAt = isoDate(recovery?.delegation?.createdAt);
  if (recovery?.delegation?.channel?.channelId !== record.channelId || recovery?.delegation?.channel?.generation !== record.generation) return false;
  return recoveryId === record.recoveryId || new Date(createdAt).getTime() > new Date(record.kitCreatedAt).getTime();
}

export function recordSyncRecoveryDrill(recordValue, drillValue) {
  const record = normalizeSyncRecoveryMaintenanceRecord(recordValue);
  const drill = normalizeDrill(drillValue);
  if (!drill || drillValue.recoveryId !== record.recoveryId || drillValue.channelId !== record.channelId || drillValue.generation !== record.generation) throw new Error("恢复演练与当前维护回执不一致");
  if (boundedCount(drillValue.authorizedDeviceCount, "恢复演练授权设备数量", 1) !== record.authorizedDeviceCount || boundedCount(drillValue.revokedDeviceCount, "恢复演练撤销设备数量") !== record.revokedDeviceCount) throw new Error("恢复演练的设备数量与维护回执不一致");
  if (drill.securityProfileHash !== record.securityProfileHash) throw new Error("恢复材料中的授权或撤销清单与维护回执不一致，应重新生成材料");
  if (new Date(drill.drilledAt).getTime() < new Date(record.kitCreatedAt).getTime() || new Date(drill.packetCreatedAt).getTime() > new Date(drill.drilledAt).getTime()) throw new Error("恢复演练时间线无效");
  return normalizeSyncRecoveryMaintenanceRecord({ ...record, lastDrill: drill });
}

export function setSyncRecoveryMaintenanceConfirmation(recordValue, confirmationId, confirmed, confirmedAtValue = new Date().toISOString()) {
  const record = normalizeSyncRecoveryMaintenanceRecord(recordValue);
  if (!CONFIRMATION_IDS.has(confirmationId)) throw new Error("恢复维护确认项不受支持");
  if (confirmationId === "retire-old-copies" && !record.previousRecoveryId) throw new Error("当前材料没有需要替换的旧副本记录");
  const confirmedAt = confirmed ? isoDate(confirmedAtValue) : "";
  return normalizeSyncRecoveryMaintenanceRecord({
    ...record,
    separateStorageConfirmedAt: confirmationId === "separate-storage" ? confirmedAt : record.separateStorageConfirmedAt,
    oldCopiesRetiredAt: confirmationId === "retire-old-copies" ? confirmedAt : record.oldCopiesRetiredAt,
  });
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * DAY_MS).toISOString();
}

function wholeDaysBetween(earlier, later) {
  return Math.max(0, Math.floor((new Date(later).getTime() - new Date(earlier).getTime()) / DAY_MS));
}

export async function assessSyncRecoveryMaintenance(channel, recordValue, nowValue = new Date().toISOString()) {
  const now = isoDate(nowValue);
  const currentHeadRevisionId = safeId(channel?.headRevisionId, "当前同步版本头", true);
  if (!recordValue) {
    return {
      status: "missing",
      headline: "尚未登记可演练的恢复材料",
      detail: currentHeadRevisionId ? "生成材料后，请用离线副本和当前同步包完成第一次演练。" : "先生成一份同步包，再生成恢复材料并完成第一次演练。",
      reasons: ["本机没有当前空间的恢复维护回执"],
      nextDrillAt: "",
      replacementReviewAt: "",
      kitAgeDays: 0,
      drillAgeDays: null,
      checklist: [
        { id: "kit", label: "当前世代恢复材料", done: false, action: "生成并下载恢复材料" },
        { id: "packet", label: "当前版本同步包", done: false, action: currentHeadRevisionId ? "选择当前版本同步包演练" : "先生成同步包" },
        { id: "drill", label: "无副作用恢复演练", done: false, action: "验证材料、口令、签名与解密" },
        { id: "separate-storage", label: "文件与口令分开保存", done: false, action: "完成后手动确认" },
      ],
    };
  }
  const record = normalizeSyncRecoveryMaintenanceRecord(recordValue);
  const profile = await createSyncRecoverySecurityProfile(channel);
  const generation = Number(channel?.generation);
  const owner = (Array.isArray(channel?.authorizedDevices) ? channel.authorizedDevices : []).find((device) => device.deviceId === channel.ownerDeviceId);
  const replacementReasons = [];
  if (channel?.retiredAt) replacementReasons.push("当前空间世代已经停用");
  if (record.channelId !== channel?.channelId || record.generation !== generation) replacementReasons.push("空间世代已经变化");
  if (!owner || record.ownerFingerprint !== owner.fingerprint) replacementReasons.push("空间所有者已经变化");
  if (record.securityProfileHash !== profile.hash) replacementReasons.push("授权或撤销设备清单已经变化");
  const replacementReviewAt = addDays(record.kitCreatedAt, RECOVERY_REPLACEMENT_REVIEW_DAYS);
  const kitAgeDays = wholeDaysBetween(record.kitCreatedAt, now);
  if (new Date(now).getTime() >= new Date(replacementReviewAt).getTime()) replacementReasons.push(`材料已到 ${RECOVERY_REPLACEMENT_REVIEW_DAYS} 天维护复核周期（不代表密码学失效）`);
  const lastDrill = record.lastDrill;
  const nextDrillAt = lastDrill ? addDays(lastDrill.drilledAt, RECOVERY_DRILL_INTERVAL_DAYS) : "";
  const drillOverdue = !lastDrill || new Date(now).getTime() >= new Date(nextDrillAt).getTime();
  const packetCurrent = Boolean(currentHeadRevisionId && lastDrill?.packetRevisionId === currentHeadRevisionId);
  const storageDone = Boolean(record.separateStorageConfirmedAt);
  const oldCopiesDone = !record.previousRecoveryId || Boolean(record.oldCopiesRetiredAt);
  let status = "ready";
  let headline = "恢复材料与当前版本线已演练";
  let detail = `下次演练在 ${nextDrillAt.slice(0, 10)} 前完成；180 天复核只是维护提醒。`;
  if (replacementReasons.length) {
    status = "replace";
    headline = "需要生成新的恢复材料";
    detail = replacementReasons[0];
  } else if (!lastDrill || drillOverdue) {
    status = "drill-due";
    headline = lastDrill ? "恢复演练已经到期" : "恢复材料尚未完成首次演练";
    detail = lastDrill ? `上次演练距今 ${wholeDaysBetween(lastDrill.drilledAt, now)} 天；请选择离线材料和同步包重新验证。` : "选择实际离线保存的恢复材料与同步包，只验证、不迁移所有权。";
  } else if (!packetCurrent) {
    status = "packet-refresh";
    headline = currentHeadRevisionId ? "离线同步包落后于当前版本头" : "当前空间还没有可配套的同步包";
    detail = currentHeadRevisionId ? "恢复材料仍可能有效，但应换入当前同步包并重新演练。" : "先生成同步包，再完成恢复演练。";
  } else if (!storageDone || !oldCopiesDone) {
    status = "storage-action";
    headline = "恢复证据已通过，离线替换尚未确认";
    detail = !storageDone ? "确认恢复文件和口令已经分开保存。" : "确认旧恢复材料副本已经从保管位置替换。";
  }
  return {
    status,
    headline,
    detail,
    reasons: replacementReasons,
    nextDrillAt,
    replacementReviewAt,
    kitAgeDays,
    drillAgeDays: lastDrill ? wholeDaysBetween(lastDrill.drilledAt, now) : null,
    checklist: [
      { id: "kit", label: "当前世代恢复材料", done: !replacementReasons.length, action: replacementReasons.length ? "重新生成材料" : `第 ${record.generation} 代 · ${record.kitCreatedAt.slice(0, 10)}` },
      { id: "packet", label: "当前版本同步包", done: packetCurrent, action: packetCurrent ? `已验证 ${currentHeadRevisionId.slice(0, 18)}…` : currentHeadRevisionId ? "选择当前版本同步包重新演练" : "先生成同步包" },
      { id: "drill", label: `${RECOVERY_DRILL_INTERVAL_DAYS} 天内恢复演练`, done: Boolean(lastDrill && !drillOverdue && !replacementReasons.length), action: lastDrill ? `上次 ${lastDrill.drilledAt.slice(0, 10)}` : "尚未演练" },
      { id: "separate-storage", label: "文件与口令分开保存", done: storageDone, action: storageDone ? `已确认 ${record.separateStorageConfirmedAt.slice(0, 10)}` : "完成后手动确认" },
      ...(record.previousRecoveryId ? [{ id: "retire-old-copies", label: "旧材料副本已替换", done: oldCopiesDone, action: oldCopiesDone ? `已确认 ${record.oldCopiesRetiredAt.slice(0, 10)}` : "逐个保管位置替换后确认" }] : []),
    ],
  };
}
