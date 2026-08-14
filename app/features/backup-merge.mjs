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

function decide(baseValue, localValue, incomingValue) {
  const base = json(baseValue);
  const local = json(localValue);
  const incoming = json(incomingValue);
  if (local === incoming) return { kind: "unchanged", defaultChoice: "local" };
  if (local === base) return { kind: "incoming", defaultChoice: "incoming" };
  if (incoming === base) return { kind: "local", defaultChoice: "local" };
  return { kind: "conflict", defaultChoice: "local" };
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
    const decision = decide(baseValue, localValue, incomingValue);
    return {
      key: `${spec.key}:${encodeURIComponent(objectId)}`,
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
    ...decide(baseValue, localValue, incomingValue),
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
    conflicts: changed.filter((entry) => entry.kind === "conflict").length,
    local: changed.filter((entry) => entry.kind === "local").length,
    incoming: changed.filter((entry) => entry.kind === "incoming").length,
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
    conflictCount: changedEntries.filter((entry) => entry.kind === "conflict").length,
    autoLocalCount: changedEntries.filter((entry) => entry.kind === "local").length,
    autoIncomingCount: changedEntries.filter((entry) => entry.kind === "incoming").length,
  };
}

export function applyBackupMerge(preview, choices = {}) {
  if (!preview?.localWorkspace || !Array.isArray(preview.groups)) throw new Error("合并预览无效");
  const workspace = clone(preview.localWorkspace);
  const sources = clone(preview.localSources);
  for (const group of preview.groups) {
    if (group.target === "workspace-singleton") {
      const entry = group.entries[0];
      const choice = entry.kind === "conflict" && choices[entry.key] === "incoming" ? "incoming" : entry.defaultChoice;
      writePath(workspace, group.spec.path, clone(choice === "incoming" ? entry.incomingValue : entry.localValue));
      continue;
    }
    const merged = [];
    for (const entry of group.entries) {
      const choice = entry.kind === "conflict" && choices[entry.key] === "incoming" ? "incoming" : entry.defaultChoice;
      const selected = choice === "incoming" ? entry.incomingValue : entry.localValue;
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
