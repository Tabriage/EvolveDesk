import { parseWorkbenchState } from "./workbench-core.mjs";
import { sanitizeBackupSources, summarizeBackup } from "./backup-core.mjs";

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

export function createBackupMergeDecisionReceipt(preview, choices = {}, contextValue = {}, createdAtValue = new Date().toISOString()) {
  if (!preview?.localWorkspace || !Array.isArray(preview.entries)) throw new Error("合并预览无效");
  const unresolved = preview.conflictKeys?.filter((key) => choices[key] !== "local" && choices[key] !== "incoming") || [];
  if (unresolved.length > 0) throw new Error(`仍有 ${unresolved.length} 个合并冲突没有明确选择`);
  const createdAt = new Date(createdAtValue).toISOString();
  const context = {
    baseRevisionId: String(contextValue.baseRevisionId || "").slice(0, 100),
    localRevisionId: String(contextValue.localRevisionId || "").slice(0, 100),
    incomingRevisionId: String(contextValue.incomingRevisionId || "").slice(0, 100),
    sourceChecksum: String(contextValue.sourceChecksum || "").slice(0, 128),
  };
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
  return {
    format: "evolve-desk.merge-decision",
    formatVersion: 1,
    createdAt,
    context,
    totals: {
      conflictDecisions: preview.conflictCount,
      autoLocalObjects: preview.autoLocalCount,
      autoIncomingObjects: preview.autoIncomingCount,
      fieldMergedObjects: preview.autoFieldMergedCount,
    },
    decisions,
  };
}
