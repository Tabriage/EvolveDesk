import { parseWorkbenchState } from "./workbench-core.mjs";
import { sanitizeBackupSources, sha256Text, summarizeBackup } from "./backup-core.mjs";
import {
  normalizeSyncPublicDevice,
  signSyncDeviceStatement,
  verifySyncDeviceStatement,
} from "./sync-core.mjs";

export const MAX_MERGE_DECISION_RECEIPT_BYTES = 512 * 1024;
const MERGE_DECISION_FORMAT = "evolve-desk.merge-decision";
const MERGE_DECISION_FORMAT_VERSION = 3;
const SEALED_MERGE_DECISION_FORMAT_VERSION = 2;
const MERGE_DECISION_SIGNATURE_PURPOSE = "merge-decision/v3";
const SAFE_REVISION_ID = /^[A-Za-z0-9_-]{8,100}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const collectionSpecs = [
  { key: "tasks", label: "任务", path: ["tasks"] },
  { key: "inbox", label: "收件箱", path: ["inbox"] },
  { key: "habits", label: "习惯", path: ["habits"] },
  { key: "activity", label: "活动记忆", path: ["activity"] },
  { key: "videos", label: "视频", path: ["videos"] },
  { key: "knowledge", label: "知识卡", path: ["knowledge"] },
  { key: "knowledgeInquiries", label: "知识问答", path: ["knowledgeInquiries"] },
  { key: "learningTopics", label: "学习专题", path: ["learningTopics"] },
  { key: "weeklyReviews", label: "周回顾", path: ["weeklyReviews"] },
  { key: "routes", label: "个人路线", path: ["routes"] },
  { key: "boards", label: "业务台", path: ["boards"] },
  { key: "creatorSignals", label: "观察信号", path: ["creator", "signals"] },
  { key: "creatorIdeas", label: "创作选题", path: ["creator", "ideas"] },
  { key: "creatorReviews", label: "内容复盘", path: ["creator", "reviews"] },
  { key: "studyCards", label: "复习卡", path: ["study", "cards"] },
  { key: "studyAttempts", label: "复习记录", path: ["study", "attempts"] },
];

const singletonSpecs = [
  { key: "focusTaskId", label: "今日焦点", path: ["focusTaskId"], title: "当前焦点任务" },
  { key: "creatorProfile", label: "创作定位", path: ["creator", "profile"], title: "创作定位" },
];

const sourceSpecs = [
  { key: "transcripts", label: "本地字幕", path: ["transcripts"], idKey: "sourceKey" },
  { key: "visualFrames", label: "采样画面", path: ["visualFrames"], idKey: "sourceKey" },
];

const categoryKeys = new Set([...collectionSpecs, ...singletonSpecs, ...sourceSpecs].map((spec) => spec.key));

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function json(value) {
  return value === undefined ? "__EVOLVE_DESK_ABSENT__" : JSON.stringify(value);
}

function readPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function writePath(value, path, next) {
  let target = value;
  for (const key of path.slice(0, -1)) target = target[key];
  target[path.at(-1)] = next;
}

function stableId(value, idKey = "id") {
  return String(value?.[idKey] || "").trim().slice(0, 2_000);
}

function itemTitle(value, fallback) {
  if (!value) return fallback;
  const candidate = value.title || value.name || value.question || value.prompt || value.label || value.content || value.sourceKey;
  return String(candidate || fallback).replace(/\s+/g, " ").trim().slice(0, 120) || fallback;
}

function stateLabel(value) {
  return value === undefined ? "不存在" : "存在";
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function decide(baseValue, localValue, incomingValue) {
  const base = json(baseValue);
  const local = json(localValue);
  const incoming = json(incomingValue);
  if (local === incoming) return { kind: "unchanged", defaultChoice: "local" };
  if (local === base) return { kind: "incoming", defaultChoice: "incoming" };
  if (incoming === base) return { kind: "local", defaultChoice: "local" };
  return { kind: "conflict", defaultChoice: "local" };
}

function fieldKey(entryKey, path) {
  return `${entryKey}#${path.map((part) => encodeURIComponent(part)).join("/")}`;
}

function mergeObjectFields(baseValue, localValue, incomingValue, entryKey, path = []) {
  const mergedValue = {};
  const fieldConflicts = [];
  let autoLocalFields = 0;
  let autoIncomingFields = 0;
  const keys = [...new Set([...Object.keys(localValue), ...Object.keys(incomingValue), ...Object.keys(baseValue)])];
  for (const key of keys) {
    const base = baseValue[key];
    const local = localValue[key];
    const incoming = incomingValue[key];
    const decision = decide(base, local, incoming);
    let selected;
    if (decision.kind === "conflict" && plainObject(base) && plainObject(local) && plainObject(incoming)) {
      const nested = mergeObjectFields(base, local, incoming, entryKey, [...path, key]);
      selected = nested.mergedValue;
      fieldConflicts.push(...nested.fieldConflicts);
      autoLocalFields += nested.autoLocalFields;
      autoIncomingFields += nested.autoIncomingFields;
    } else if (decision.kind === "conflict") {
      selected = local;
      fieldConflicts.push({
        key: fieldKey(entryKey, [...path, key]),
        path: [...path, key],
        label: [...path, key].join(" › "),
        baseValue: base,
        localValue: local,
        incomingValue: incoming,
        localState: stateLabel(local),
        incomingState: stateLabel(incoming),
      });
    } else if (decision.defaultChoice === "incoming") {
      selected = incoming;
      if (decision.kind === "incoming") autoIncomingFields += 1;
    } else {
      selected = local;
      if (decision.kind === "local") autoLocalFields += 1;
    }
    if (selected !== undefined) mergedValue[key] = clone(selected);
  }
  return { mergedValue, fieldConflicts, autoLocalFields, autoIncomingFields };
}

function enrichDecision(entryKey, baseValue, localValue, incomingValue) {
  const decision = decide(baseValue, localValue, incomingValue);
  if (decision.kind !== "conflict" || !plainObject(baseValue) || !plainObject(localValue) || !plainObject(incomingValue)) {
    return { ...decision, resolution: "object", fieldConflicts: [], mergedValue: undefined, autoLocalFields: 0, autoIncomingFields: 0, conflictCount: decision.kind === "conflict" ? 1 : 0 };
  }
  const fields = mergeObjectFields(baseValue, localValue, incomingValue, entryKey);
  return {
    kind: fields.fieldConflicts.length ? "conflict" : "merged",
    defaultChoice: "local",
    resolution: "fields",
    ...fields,
    conflictCount: fields.fieldConflicts.length,
  };
}

function orderedIds(baseItems, localItems, incomingItems, idKey) {
  const seen = new Set();
  const ordered = [];
  for (const item of [...localItems, ...incomingItems, ...baseItems]) {
    const id = stableId(item, idKey);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

function collectionEntries(spec, baseItems, localItems, incomingItems, idKey = "id") {
  const base = new Map(baseItems.map((item) => [stableId(item, idKey), item]));
  const local = new Map(localItems.map((item) => [stableId(item, idKey), item]));
  const incoming = new Map(incomingItems.map((item) => [stableId(item, idKey), item]));
  return orderedIds(baseItems, localItems, incomingItems, idKey).map((objectId) => {
    const baseValue = base.get(objectId);
    const localValue = local.get(objectId);
    const incomingValue = incoming.get(objectId);
    const key = `${spec.key}:${encodeURIComponent(objectId)}`;
    const decision = enrichDecision(key, baseValue, localValue, incomingValue);
    return {
      key,
      categoryKey: spec.key,
      categoryLabel: spec.label,
      objectId,
      title: itemTitle(localValue || incomingValue || baseValue, objectId),
      ...decision,
      baseState: stateLabel(baseValue),
      localState: stateLabel(localValue),
      incomingState: stateLabel(incomingValue),
      baseValue,
      localValue,
      incomingValue,
    };
  });
}

function singletonEntry(spec, baseRoot, localRoot, incomingRoot) {
  const baseValue = readPath(baseRoot, spec.path);
  const localValue = readPath(localRoot, spec.path);
  const incomingValue = readPath(incomingRoot, spec.path);
  return {
    key: spec.key,
    categoryKey: spec.key,
    categoryLabel: spec.label,
    objectId: spec.key,
    title: spec.title,
    ...enrichDecision(spec.key, baseValue, localValue, incomingValue),
    baseState: stateLabel(baseValue),
    localState: stateLabel(localValue),
    incomingState: stateLabel(incomingValue),
    baseValue,
    localValue,
    incomingValue,
  };
}

function summarizeEntries(entries, spec) {
  const changed = entries.filter((entry) => entry.kind !== "unchanged");
  return {
    key: spec.key,
    label: spec.label,
    total: entries.length,
    changed: changed.length,
    conflicts: changed.reduce((total, entry) => total + entry.conflictCount, 0),
    local: changed.filter((entry) => entry.kind === "local").length,
    incoming: changed.filter((entry) => entry.kind === "incoming").length,
    merged: changed.filter((entry) => entry.kind === "merged").length,
  };
}

function safeWorkspace(value) {
  return parseWorkbenchState(JSON.stringify(value || {}));
}

function safeSources(value, workspace) {
  return sanitizeBackupSources(value || {}, workspace);
}

export function createBackupMergePreview(baseWorkspaceValue, localWorkspaceValue, incomingWorkspaceValue, baseSourcesValue = {}, localSourcesValue = {}, incomingSourcesValue = {}) {
  const baseWorkspace = safeWorkspace(baseWorkspaceValue);
  const localWorkspace = safeWorkspace(localWorkspaceValue);
  const incomingWorkspace = safeWorkspace(incomingWorkspaceValue);
  const baseSources = safeSources(baseSourcesValue, baseWorkspace);
  const localSources = safeSources(localSourcesValue, localWorkspace);
  const incomingSources = safeSources(incomingSourcesValue, incomingWorkspace);
  const groups = [];

  for (const spec of collectionSpecs) {
    const entries = collectionEntries(spec, readPath(baseWorkspace, spec.path), readPath(localWorkspace, spec.path), readPath(incomingWorkspace, spec.path));
    groups.push({ spec, target: "workspace", entries });
  }
  for (const spec of singletonSpecs) {
    groups.push({ spec, target: "workspace-singleton", entries: [singletonEntry(spec, baseWorkspace, localWorkspace, incomingWorkspace)] });
  }
  for (const spec of sourceSpecs) {
    const entries = collectionEntries(spec, readPath(baseSources, spec.path), readPath(localSources, spec.path), readPath(incomingSources, spec.path), spec.idKey);
    groups.push({ spec, target: "sources", entries });
  }

  const entries = groups.flatMap((group) => group.entries);
  const changedEntries = entries.filter((entry) => entry.kind !== "unchanged");
  return {
    baseWorkspace,
    localWorkspace,
    incomingWorkspace,
    baseSources,
    localSources,
    incomingSources,
    groups,
    rows: groups.map((group) => summarizeEntries(group.entries, group.spec)).filter((row) => row.changed > 0),
    entries: changedEntries,
    conflictCount: changedEntries.reduce((total, entry) => total + entry.conflictCount, 0),
    conflictKeys: changedEntries.flatMap((entry) => entry.resolution === "fields" ? entry.fieldConflicts.map((field) => field.key) : entry.kind === "conflict" ? [entry.key] : []),
    autoLocalCount: changedEntries.filter((entry) => entry.kind === "local").length,
    autoIncomingCount: changedEntries.filter((entry) => entry.kind === "incoming").length,
    autoFieldMergedCount: changedEntries.filter((entry) => entry.kind === "merged" || entry.resolution === "fields").length,
  };
}

function writeField(value, path, next) {
  let target = value;
  for (const key of path.slice(0, -1)) target = target[key];
  const key = path.at(-1);
  if (next === undefined) delete target[key];
  else target[key] = clone(next);
}

function resolvedEntryValue(entry, choices) {
  if (entry.resolution !== "fields") {
    const choice = entry.kind === "conflict" && choices[entry.key] === "incoming" ? "incoming" : entry.defaultChoice;
    return choice === "incoming" ? entry.incomingValue : entry.localValue;
  }
  const merged = clone(entry.mergedValue);
  for (const field of entry.fieldConflicts) {
    const selected = choices[field.key] === "incoming" ? field.incomingValue : field.localValue;
    writeField(merged, field.path, selected);
  }
  return merged;
}

export function applyBackupMerge(preview, choices = {}) {
  if (!preview?.localWorkspace || !Array.isArray(preview.groups)) throw new Error("合并预览无效");
  const workspace = clone(preview.localWorkspace);
  const sources = clone(preview.localSources);
  for (const group of preview.groups) {
    if (group.target === "workspace-singleton") {
      const entry = group.entries[0];
      writePath(workspace, group.spec.path, clone(resolvedEntryValue(entry, choices)));
      continue;
    }
    const merged = [];
    for (const entry of group.entries) {
      const selected = resolvedEntryValue(entry, choices);
      if (selected !== undefined) merged.push(clone(selected));
    }
    writePath(group.target === "sources" ? sources : workspace, group.spec.path, merged);
  }
  const safeMergedWorkspace = safeWorkspace(workspace);
  const safeMergedSources = safeSources(sources, safeMergedWorkspace);
  return {
    workspace: safeMergedWorkspace,
    sources: safeMergedSources,
    summary: summarizeBackup(safeMergedWorkspace, safeMergedSources),
  };
}

export function applyBackupMergeChoiceBatch(preview, choices = {}, keys = [], choice) {
  if (!preview || !Array.isArray(preview.conflictKeys)) throw new Error("合并预览无效");
  if (choice !== "local" && choice !== "incoming") throw new Error("批量选择必须明确为本机或迁入");
  if (!Array.isArray(keys) || keys.length > 4_096) throw new Error("批量选择范围无效");
  const allowed = new Set(preview.conflictKeys);
  const requested = [...new Set(keys)];
  if (requested.some((key) => typeof key !== "string" || !allowed.has(key))) throw new Error("批量选择包含当前预览之外的冲突");
  const next = { ...choices };
  const appliedKeys = [];
  for (const key of requested) {
    if (next[key] === "local" || next[key] === "incoming") continue;
    next[key] = choice;
    appliedKeys.push(key);
  }
  return { choices: next, appliedKeys };
}

function decisionManifest(decisions) {
  return decisions.map((decision) => decision.resolution === "fields" ? {
    categoryKey: decision.categoryKey,
    objectId: decision.objectId,
    resolution: "fields",
    paths: decision.fields.map((field) => field.path),
  } : {
    categoryKey: decision.categoryKey,
    objectId: decision.objectId,
    resolution: "object",
  });
}

function previewConflictManifest(preview) {
  return preview.entries.filter((entry) => entry.kind === "conflict").map((entry) => entry.resolution === "fields" ? {
    categoryKey: entry.categoryKey,
    objectId: entry.objectId,
    resolution: "fields",
    paths: entry.fieldConflicts.map((field) => field.path),
  } : {
    categoryKey: entry.categoryKey,
    objectId: entry.objectId,
    resolution: "object",
  });
}

function receiptContent(value, formatVersion = SEALED_MERGE_DECISION_FORMAT_VERSION) {
  return {
    format: MERGE_DECISION_FORMAT,
    formatVersion,
    createdAt: value.createdAt,
    context: value.context,
    manifest: value.manifest,
    totals: value.totals,
    decisions: value.decisions,
    ...(formatVersion === MERGE_DECISION_FORMAT_VERSION ? { signer: value.signer } : {}),
  };
}

function receiptSignaturePayload(value) {
  return JSON.stringify({
    format: MERGE_DECISION_FORMAT,
    formatVersion: MERGE_DECISION_FORMAT_VERSION,
    receiptId: value.receiptId,
    integrity: value.integrity,
  });
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}不是有效对象`);
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) throw new Error(`${label}包含缺失或未声明字段`);
}

function boundedText(value, limit, label, allowEmpty = false) {
  if (typeof value !== "string" || value !== value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value) || (!allowEmpty && !value)) throw new Error(`${label}无效`);
  return value;
}

function revisionId(value, label, legacy = false) {
  const candidate = boundedText(value, 100, label, legacy);
  if (!legacy && !SAFE_REVISION_ID.test(candidate)) throw new Error(`${label}无效`);
  return candidate;
}

function isoDate(value) {
  const candidate = boundedText(value, 40, "决策回执时间");
  if (!Number.isFinite(new Date(candidate).getTime()) || new Date(candidate).toISOString() !== candidate) throw new Error("决策回执时间无效");
  return candidate;
}

function nonNegativeInteger(value, label) {
  const candidate = Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate > 1_000_000) throw new Error(`${label}无效`);
  return candidate;
}

function normalizeContext(value, legacy = false, channelBound = false) {
  exactKeys(value, [...(channelBound ? ["channelId"] : []), "baseRevisionId", "localRevisionId", "incomingRevisionId", "sourceChecksum"], "决策回执版本上下文");
  const sourceChecksum = boundedText(value.sourceChecksum, 128, "决策回执源卷校验", legacy);
  if (!legacy && !SHA256.test(sourceChecksum)) throw new Error("决策回执源卷校验无效");
  return {
    ...(channelBound ? { channelId: revisionId(value.channelId, "同步空间标识") } : {}),
    baseRevisionId: revisionId(value.baseRevisionId, "共同父版本标识", legacy),
    localRevisionId: revisionId(value.localRevisionId, "本机版本标识", legacy),
    incomingRevisionId: revisionId(value.incomingRevisionId, "迁入版本标识", legacy),
    sourceChecksum,
  };
}

function normalizePath(value) {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error("决策回执字段路径无效");
  return value.map((part) => boundedText(part, 200, "决策回执字段路径"));
}

function normalizeDecisions(value) {
  if (!Array.isArray(value) || value.length > 4_096) throw new Error("决策回执选择数量无效");
  const seen = new Set();
  let conflictDecisions = 0;
  const decisions = value.map((decision) => {
    const resolution = decision?.resolution;
    const expectedKeys = resolution === "fields" ? ["categoryKey", "objectId", "resolution", "fields"] : ["categoryKey", "objectId", "resolution", "choice"];
    exactKeys(decision, expectedKeys, "决策回执选择");
    const categoryKey = boundedText(decision.categoryKey, 80, "决策回执对象类别");
    if (!categoryKeys.has(categoryKey)) throw new Error("决策回执包含未知对象类别");
    const objectId = boundedText(decision.objectId, 2_000, "决策回执对象标识");
    const decisionKey = `${categoryKey}:${objectId}`;
    if (seen.has(decisionKey)) throw new Error("决策回执包含重复对象选择");
    seen.add(decisionKey);
    if (resolution === "object") {
      if (decision.choice !== "local" && decision.choice !== "incoming") throw new Error("决策回执对象选择无效");
      conflictDecisions += 1;
      return { categoryKey, objectId, resolution, choice: decision.choice };
    }
    if (resolution !== "fields" || !Array.isArray(decision.fields) || !decision.fields.length || decision.fields.length > 4_096) throw new Error("决策回执字段选择无效");
    const seenPaths = new Set();
    const fields = decision.fields.map((field) => {
      exactKeys(field, ["path", "choice"], "决策回执字段选择");
      const path = normalizePath(field.path);
      const pathKey = JSON.stringify(path);
      if (seenPaths.has(pathKey)) throw new Error("决策回执包含重复字段路径");
      seenPaths.add(pathKey);
      if (field.choice !== "local" && field.choice !== "incoming") throw new Error("决策回执字段选择无效");
      return { path, choice: field.choice };
    });
    conflictDecisions += fields.length;
    return { categoryKey, objectId, resolution, fields };
  });
  return { decisions, conflictDecisions };
}

function normalizeTotals(value, conflictDecisions) {
  exactKeys(value, ["conflictDecisions", "autoLocalObjects", "autoIncomingObjects", "fieldMergedObjects"], "决策回执统计");
  const totals = {
    conflictDecisions: nonNegativeInteger(value.conflictDecisions, "决策回执冲突数量"),
    autoLocalObjects: nonNegativeInteger(value.autoLocalObjects, "决策回执本机自动对象数量"),
    autoIncomingObjects: nonNegativeInteger(value.autoIncomingObjects, "决策回执迁入自动对象数量"),
    fieldMergedObjects: nonNegativeInteger(value.fieldMergedObjects, "决策回执字段合并对象数量"),
  };
  if (totals.conflictDecisions !== conflictDecisions) throw new Error("决策回执统计与逐项选择数量不一致");
  return totals;
}

function normalizeLegacyReceipt(value) {
  exactKeys(value, ["format", "formatVersion", "createdAt", "context", "totals", "decisions"], "旧版决策回执");
  const normalized = normalizeDecisions(value.decisions);
  return {
    format: MERGE_DECISION_FORMAT,
    formatVersion: 1,
    createdAt: isoDate(value.createdAt),
    context: normalizeContext(value.context, true),
    totals: normalizeTotals(value.totals, normalized.conflictDecisions),
    decisions: normalized.decisions,
  };
}

async function normalizeSealedReceipt(value) {
  exactKeys(value, ["format", "formatVersion", "receiptId", "createdAt", "context", "manifest", "totals", "decisions", "integrity"], "决策回执");
  const normalized = normalizeDecisions(value.decisions);
  exactKeys(value.manifest, ["algorithm", "conflictSetHash", "conflictCount"], "决策回执冲突清单");
  if (value.manifest.algorithm !== "SHA-256" || !SHA256.test(String(value.manifest.conflictSetHash || ""))) throw new Error("决策回执冲突清单校验无效");
  const manifest = { algorithm: "SHA-256", conflictSetHash: value.manifest.conflictSetHash, conflictCount: nonNegativeInteger(value.manifest.conflictCount, "决策回执冲突清单数量") };
  if (manifest.conflictCount !== normalized.conflictDecisions) throw new Error("决策回执冲突清单数量不一致");
  const expectedManifestHash = await sha256Text(JSON.stringify(decisionManifest(normalized.decisions)));
  if (expectedManifestHash !== manifest.conflictSetHash) throw new Error("决策回执冲突清单已被修改");
  const content = receiptContent({
    createdAt: isoDate(value.createdAt),
    context: normalizeContext(value.context),
    manifest,
    totals: normalizeTotals(value.totals, normalized.conflictDecisions),
    decisions: normalized.decisions,
  });
  exactKeys(value.integrity, ["algorithm", "digest"], "决策回执完整性封签");
  if (value.integrity.algorithm !== "SHA-256" || !SHA256.test(String(value.integrity.digest || ""))) throw new Error("决策回执完整性封签无效");
  const digest = await sha256Text(JSON.stringify(content));
  if (digest !== value.integrity.digest || value.receiptId !== `decision_${digest.slice(0, 32)}`) throw new Error("决策回执完整性封签不一致，文件可能已被修改");
  return { ...content, receiptId: value.receiptId, integrity: { algorithm: "SHA-256", digest } };
}

async function normalizeSignedReceipt(value) {
  exactKeys(value, ["format", "formatVersion", "receiptId", "createdAt", "context", "manifest", "totals", "decisions", "signer", "integrity", "proof"], "设备签名决策回执");
  if (value.format !== MERGE_DECISION_FORMAT || value.formatVersion !== MERGE_DECISION_FORMAT_VERSION) throw new Error("设备签名决策回执格式无效");
  const normalized = normalizeDecisions(value.decisions);
  exactKeys(value.manifest, ["algorithm", "conflictSetHash", "conflictCount"], "决策回执冲突清单");
  if (value.manifest.algorithm !== "SHA-256" || !SHA256.test(String(value.manifest.conflictSetHash || ""))) throw new Error("决策回执冲突清单校验无效");
  const manifest = { algorithm: "SHA-256", conflictSetHash: value.manifest.conflictSetHash, conflictCount: nonNegativeInteger(value.manifest.conflictCount, "决策回执冲突清单数量") };
  if (manifest.conflictCount !== normalized.conflictDecisions) throw new Error("决策回执冲突清单数量不一致");
  const expectedManifestHash = await sha256Text(JSON.stringify(decisionManifest(normalized.decisions)));
  if (expectedManifestHash !== manifest.conflictSetHash) throw new Error("决策回执冲突清单已被修改");
  const signer = await normalizeSyncPublicDevice(value.signer);
  const content = receiptContent({
    createdAt: isoDate(value.createdAt),
    context: normalizeContext(value.context, false, true),
    manifest,
    totals: normalizeTotals(value.totals, normalized.conflictDecisions),
    decisions: normalized.decisions,
    signer,
  }, MERGE_DECISION_FORMAT_VERSION);
  exactKeys(value.integrity, ["algorithm", "digest"], "决策回执完整性封签");
  if (value.integrity.algorithm !== "SHA-256" || !SHA256.test(String(value.integrity.digest || ""))) throw new Error("决策回执完整性封签无效");
  const digest = await sha256Text(JSON.stringify(content));
  const receiptId = `decision_${digest.slice(0, 32)}`;
  if (digest !== value.integrity.digest || value.receiptId !== receiptId) throw new Error("决策回执完整性封签不一致，文件可能已被修改");
  const integrity = { algorithm: "SHA-256", digest };
  const verified = await verifySyncDeviceStatement(signer, value.proof, MERGE_DECISION_SIGNATURE_PURPOSE, receiptSignaturePayload({ receiptId, integrity }));
  return { ...content, receiptId, integrity, proof: verified.proof };
}

export async function createBackupMergeDecisionReceipt(preview, choices = {}, contextValue = {}, createdAtValue = new Date().toISOString()) {
  if (!preview?.localWorkspace || !Array.isArray(preview.entries)) throw new Error("合并预览无效");
  const unresolved = preview.conflictKeys?.filter((key) => choices[key] !== "local" && choices[key] !== "incoming") || [];
  if (unresolved.length > 0) throw new Error(`仍有 ${unresolved.length} 个合并冲突没有明确选择`);
  const createdAt = isoDate(new Date(createdAtValue).toISOString());
  const context = normalizeContext(contextValue);
  const decisions = preview.entries.filter((entry) => entry.kind === "conflict").map((entry) => entry.resolution === "fields" ? {
    categoryKey: entry.categoryKey,
    objectId: entry.objectId,
    resolution: "fields",
    fields: entry.fieldConflicts.map((field) => ({ path: field.path, choice: choices[field.key] === "incoming" ? "incoming" : "local" })),
  } : {
    categoryKey: entry.categoryKey,
    objectId: entry.objectId,
    resolution: "object",
    choice: choices[entry.key] === "incoming" ? "incoming" : "local",
  });
  const manifest = {
    algorithm: "SHA-256",
    conflictSetHash: await sha256Text(JSON.stringify(decisionManifest(decisions))),
    conflictCount: preview.conflictCount,
  };
  const content = receiptContent({
    createdAt,
    context,
    manifest,
    totals: {
      conflictDecisions: preview.conflictCount,
      autoLocalObjects: preview.autoLocalCount,
      autoIncomingObjects: preview.autoIncomingCount,
      fieldMergedObjects: preview.autoFieldMergedCount,
    },
    decisions,
  });
  const digest = await sha256Text(JSON.stringify(content));
  return { ...content, receiptId: `decision_${digest.slice(0, 32)}`, integrity: { algorithm: "SHA-256", digest } };
}

export async function createSignedBackupMergeDecisionReceipt(preview, choices = {}, contextValue = {}, identity, createdAtValue = new Date().toISOString()) {
  const context = normalizeContext(contextValue, false, true);
  const unsigned = await createBackupMergeDecisionReceipt(preview, choices, {
    baseRevisionId: context.baseRevisionId,
    localRevisionId: context.localRevisionId,
    incomingRevisionId: context.incomingRevisionId,
    sourceChecksum: context.sourceChecksum,
  }, createdAtValue);
  const signer = await normalizeSyncPublicDevice(identity?.device);
  const content = receiptContent({ ...unsigned, context, signer }, MERGE_DECISION_FORMAT_VERSION);
  const digest = await sha256Text(JSON.stringify(content));
  const receiptId = `decision_${digest.slice(0, 32)}`;
  const integrity = { algorithm: "SHA-256", digest };
  const proof = await signSyncDeviceStatement(identity, MERGE_DECISION_SIGNATURE_PURPOSE, receiptSignaturePayload({ receiptId, integrity }));
  return { ...content, receiptId, integrity, proof };
}

export function serializeBackupMergeDecisionReceipt(receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (byteLength(serialized) > MAX_MERGE_DECISION_RECEIPT_BYTES) throw new Error("合并决策回执超过 512 KiB 上限");
  return serialized;
}

export async function inspectBackupMergeDecisionReceiptText(raw) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_MERGE_DECISION_RECEIPT_BYTES) throw new Error("合并决策回执为空或超过 512 KiB 上限");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("合并决策回执不是有效的 JSON 文件");
  }
  if (value?.format !== MERGE_DECISION_FORMAT) throw new Error("这不是 Evolve Desk 合并决策回执");
  if (![1, SEALED_MERGE_DECISION_FORMAT_VERSION, MERGE_DECISION_FORMAT_VERSION].includes(value.formatVersion)) throw new Error("合并决策回执版本不受支持");
  const receipt = value.formatVersion === 1
    ? normalizeLegacyReceipt(value)
    : value.formatVersion === SEALED_MERGE_DECISION_FORMAT_VERSION
      ? await normalizeSealedReceipt(value)
      : await normalizeSignedReceipt(value);
  const categories = new Set(receipt.decisions.map((decision) => decision.categoryKey));
  return {
    receipt,
    sealed: receipt.formatVersion >= SEALED_MERGE_DECISION_FORMAT_VERSION,
    signed: receipt.formatVersion === MERGE_DECISION_FORMAT_VERSION,
    signatureValid: receipt.formatVersion === MERGE_DECISION_FORMAT_VERSION,
    signer: receipt.formatVersion === MERGE_DECISION_FORMAT_VERSION ? receipt.signer : null,
    digest: receipt.formatVersion >= SEALED_MERGE_DECISION_FORMAT_VERSION ? receipt.integrity.digest : "",
    conflictDecisions: receipt.totals.conflictDecisions,
    objectDecisions: receipt.decisions.length,
    categoryCount: categories.size,
  };
}

export async function compareBackupMergeDecisionReceiptToPreview(receipt, preview, contextValue) {
  if (!preview?.localWorkspace || !Array.isArray(preview.entries)) throw new Error("合并预览无效");
  const channelBound = receipt?.formatVersion === MERGE_DECISION_FORMAT_VERSION;
  const context = normalizeContext(channelBound ? contextValue : {
    baseRevisionId: contextValue?.baseRevisionId,
    localRevisionId: contextValue?.localRevisionId,
    incomingRevisionId: contextValue?.incomingRevisionId,
    sourceChecksum: contextValue?.sourceChecksum,
  }, false, channelBound);
  const contextReasons = [];
  for (const key of [...(channelBound ? ["channelId"] : []), "baseRevisionId", "localRevisionId", "incomingRevisionId", "sourceChecksum"]) {
    if (receipt.context?.[key] !== context[key]) contextReasons.push(`${key} 与当前三方预览不一致`);
  }
  const expectedManifest = previewConflictManifest(preview);
  const receivedManifest = decisionManifest(receipt.decisions || []);
  const conflictSetMatches = JSON.stringify(receivedManifest) === JSON.stringify(expectedManifest);
  const reasons = [...contextReasons];
  if (!conflictSetMatches) reasons.push("冲突对象或字段路径与当前三方预览不一致");
  return {
    matches: reasons.length === 0,
    contextMatches: contextReasons.length === 0,
    conflictSetMatches,
    reasons,
    expectedConflictDecisions: preview.conflictCount,
    receiptConflictDecisions: receipt.totals?.conflictDecisions || 0,
  };
}

export async function assessBackupMergeDecisionReceiptTrust(receiptValue, channelsValue = []) {
  if (receiptValue?.formatVersion !== MERGE_DECISION_FORMAT_VERSION) {
    return { signed: false, signatureValid: false, trusted: false, channelKnown: false, channelLabel: "", channelRetired: false, signer: null, reason: "这份回执没有设备签名" };
  }
  const receipt = await normalizeSignedReceipt(receiptValue);
  const channel = (Array.isArray(channelsValue) ? channelsValue : []).find((candidate) => candidate?.channelId === receipt.context.channelId);
  if (!channel) return { signed: true, signatureValid: true, trusted: false, channelKnown: false, channelLabel: "", channelRetired: false, signer: receipt.signer, reason: "本机没有保存这份回执对应的同步空间，无法确认成员关系" };
  const authorized = [];
  for (const candidate of Array.isArray(channel.authorizedDevices) ? channel.authorizedDevices : []) {
    try {
      authorized.push(await normalizeSyncPublicDevice(candidate));
    } catch {
      // Ignore malformed local membership entries instead of trusting their identifiers.
    }
  }
  const revoked = Array.isArray(channel.revokedDeviceIds) && channel.revokedDeviceIds.includes(receipt.signer.deviceId);
  const member = authorized.find((candidate) => candidate.deviceId === receipt.signer.deviceId && candidate.fingerprint === receipt.signer.fingerprint);
  const trusted = Boolean(member && !revoked);
  return {
    signed: true,
    signatureValid: true,
    trusted,
    channelKnown: true,
    channelLabel: String(channel.label || "").slice(0, 80),
    channelRetired: Boolean(channel.retiredAt),
    signer: receipt.signer,
    reason: revoked
      ? "签发设备已在本机保存的该空间记录中撤销"
      : member
        ? `签发者属于本机保存的该空间授权清单${channel.retiredAt ? "；该空间现已停用" : ""}`
        : "签发者不在本机保存的该空间授权清单中",
  };
}
