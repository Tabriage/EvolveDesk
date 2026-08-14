import { CURRENT_WORKSPACE_VERSION, parseBackupText } from "./backup-core.mjs";

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
  { key: "transcripts", label: "本地字幕", path: ["transcripts"], source: true, idKey: "sourceKey" },
  { key: "visualFrames", label: "画面来源", path: ["visualFrames"], source: true, idKey: "sourceKey" },
];

function readPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function arrayAt(value, path) {
  const candidate = readPath(value, path);
  return Array.isArray(candidate) ? candidate : [];
}

function itemId(value, idKey = "id") {
  return String(value?.[idKey] || "").trim();
}

function json(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function countReferences(workspace) {
  let count = workspace?.focusTaskId ? 1 : 0;
  for (const route of arrayAt(workspace, ["routes"])) {
    for (const phase of Array.isArray(route?.phases) ? route.phases : []) {
      for (const action of Array.isArray(phase?.actions) ? phase.actions : []) {
        if (action?.linkedTaskId) count += 1;
        if (action?.linkedHabitId) count += 1;
      }
    }
  }
  for (const board of arrayAt(workspace, ["boards"])) {
    if (board?.linkedRouteId) count += 1;
    for (const record of Array.isArray(board?.records) ? board.records : []) if (record?.linkedTaskId) count += 1;
  }
  for (const idea of arrayAt(workspace, ["creator", "ideas"])) {
    if (idea?.linkedTaskId) count += 1;
    if (idea?.linkedBoardId) count += 1;
    if (idea?.linkedBoardRecordId) count += 1;
    count += Array.isArray(idea?.sourceRefs) ? idea.sourceRefs.length : 0;
  }
  for (const topic of arrayAt(workspace, ["learningTopics"])) count += Array.isArray(topic?.sources) ? topic.sources.length : 0;
  for (const card of arrayAt(workspace, ["study", "cards"])) count += Array.isArray(card?.sources) ? card.sources.length : 0;
  return count;
}

function countFrames(sources) {
  return arrayAt(sources, ["visualFrames"]).reduce((total, record) => total + (Array.isArray(record?.frames) ? record.frames.length : 0), 0);
}

export function createCompatibilityReport(rawWorkspaceValue, rawSourcesValue, normalizedWorkspace, normalizedSources, sourceVersionValue) {
  const rawWorkspace = rawWorkspaceValue && typeof rawWorkspaceValue === "object" ? rawWorkspaceValue : {};
  const rawSources = rawSourcesValue && typeof rawSourcesValue === "object" ? rawSourcesValue : {};
  const sourceVersion = Number(sourceVersionValue);
  const changes = [];
  let droppedObjects = 0;
  let normalizedObjects = 0;

  for (const spec of collectionSpecs) {
    const rawRoot = spec.source ? rawSources : rawWorkspace;
    const normalizedRoot = spec.source ? normalizedSources : normalizedWorkspace;
    const beforeItems = arrayAt(rawRoot, spec.path);
    const afterItems = arrayAt(normalizedRoot, spec.path);
    const beforeById = new Map(beforeItems.map((item) => [itemId(item, spec.idKey), item]).filter(([id]) => id));
    const afterById = new Map(afterItems.map((item) => [itemId(item, spec.idKey), item]).filter(([id]) => id));
    const dropped = Math.max(0, beforeItems.length - afterItems.length);
    let normalized = 0;
    for (const [id, after] of afterById) {
      const before = beforeById.get(id);
      if (before && json(before) !== json(after)) normalized += 1;
    }
    droppedObjects += dropped;
    normalizedObjects += normalized;
    if (dropped || normalized) changes.push({
      key: spec.key,
      label: spec.label,
      before: beforeItems.length,
      after: afterItems.length,
      dropped,
      normalized,
      severity: dropped ? "warning" : "info",
    });
  }

  const rawReferences = countReferences(rawWorkspace);
  const normalizedReferences = countReferences(normalizedWorkspace);
  const repairedReferences = Math.max(0, rawReferences - normalizedReferences);
  if (repairedReferences) changes.push({
    key: "references",
    label: "对象引用",
    before: rawReferences,
    after: normalizedReferences,
    dropped: repairedReferences,
    normalized: 0,
    severity: "warning",
  });

  const rawFrames = countFrames(rawSources);
  const normalizedFrames = countFrames(normalizedSources);
  const droppedFrames = Math.max(0, rawFrames - normalizedFrames);
  if (droppedFrames) changes.push({
    key: "frames",
    label: "采样帧",
    before: rawFrames,
    after: normalizedFrames,
    dropped: droppedFrames,
    normalized: 0,
    severity: "warning",
  });

  const migrationRequired = sourceVersion < CURRENT_WORKSPACE_VERSION;
  const warningCount = changes.filter((change) => change.severity === "warning").length;
  return {
    sourceVersion,
    targetVersion: CURRENT_WORKSPACE_VERSION,
    migrationRequired,
    status: warningCount ? "attention" : migrationRequired ? "migration" : "ready",
    droppedObjects,
    normalizedObjects,
    repairedReferences,
    droppedFrames,
    warningCount,
    changes,
  };
}

export async function inspectBackupCompatibility(raw) {
  const parsed = await parseBackupText(raw);
  const envelope = JSON.parse(raw);
  const report = createCompatibilityReport(
    envelope.payload?.workspace,
    envelope.payload?.sources,
    parsed.workspace,
    parsed.sources,
    envelope.workspaceVersion,
  );
  return { parsed, report };
}
