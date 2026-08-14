import { parseWorkbenchState } from "./workbench-core.mjs";

export const BACKUP_FORMAT = "evolve-desk.backup";
export const BACKUP_FORMAT_VERSION = 1;
export const MAX_BACKUP_BYTES = 96 * 1024 * 1024;

const CURRENT_WORKSPACE_VERSION = 11;
const MAX_SOURCE_RECORDS = 80;
const MAX_SOURCE_KEY_CHARS = 2_000;
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_VISUAL_FRAMES = 8;
const MAX_FRAME_DATA_CHARS = 620_000;
const JPEG_DATA_URL = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]*$/;

const categories = [
  { key: "tasks", label: "任务", select: (state) => state.tasks },
  { key: "inbox", label: "收件箱", select: (state) => state.inbox },
  { key: "habits", label: "习惯", select: (state) => state.habits },
  { key: "routes", label: "个人路线", select: (state) => state.routes },
  { key: "boards", label: "业务台", select: (state) => state.boards },
  { key: "creatorIdeas", label: "创作选题", select: (state) => state.creator.ideas },
  { key: "videos", label: "视频", select: (state) => state.videos },
  { key: "knowledge", label: "知识卡", select: (state) => state.knowledge },
  { key: "learningTopics", label: "学习专题", select: (state) => state.learningTopics },
  { key: "studyCards", label: "复习卡", select: (state) => state.study.cards },
  { key: "weeklyReviews", label: "周回顾", select: (state) => state.weeklyReviews },
  { key: "activity", label: "活动记忆", select: (state) => state.activity },
];

function text(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function isoDate(value, fallback = "") {
  const candidate = text(value, 40);
  return Number.isFinite(new Date(candidate).getTime()) ? new Date(candidate).toISOString() : fallback;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function jsonValue(value) {
  try {
    return JSON.stringify(value);
  } catch {
    throw new Error("工作台数据无法序列化");
  }
}

function checksumContent({ format, formatVersion, workspaceVersion, exportedAt, payload }) {
  return { format, formatVersion, workspaceVersion, exportedAt, payload };
}

export async function sha256Text(value) {
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持备份完整性校验");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function sanitizeBackupSources(value, workspace) {
  const source = value && typeof value === "object" ? value : {};
  const videoFrameIds = new Map(workspace.videos.map((video) => [video.url, new Set(video.visualEvidence.map((frame) => frame.id))]));
  const validSourceKeys = new Set(videoFrameIds.keys());
  const transcripts = new Map();
  for (const record of (Array.isArray(source.transcripts) ? source.transcripts : []).slice(-MAX_SOURCE_RECORDS)) {
    const sourceKey = text(record?.sourceKey, MAX_SOURCE_KEY_CHARS);
    const transcript = text(record?.transcript, MAX_TRANSCRIPT_CHARS);
    if (!sourceKey || !validSourceKeys.has(sourceKey) || !transcript) continue;
    transcripts.set(sourceKey, {
      sourceKey,
      transcript,
      updatedAt: isoDate(record?.updatedAt),
    });
  }

  const visualFrames = new Map();
  for (const record of (Array.isArray(source.visualFrames) ? source.visualFrames : []).slice(-MAX_SOURCE_RECORDS)) {
    const sourceKey = text(record?.sourceKey, MAX_SOURCE_KEY_CHARS);
    const allowedIds = videoFrameIds.get(sourceKey);
    if (!sourceKey || !allowedIds) continue;
    const seen = new Set();
    const frames = (Array.isArray(record?.frames) ? record.frames : []).slice(0, MAX_VISUAL_FRAMES).map((frame) => ({
      id: text(frame?.id, 100),
      imageDataUrl: String(frame?.imageDataUrl || ""),
    })).filter((frame) => {
      if (!frame.id || seen.has(frame.id) || !allowedIds.has(frame.id)) return false;
      if (frame.imageDataUrl.length > MAX_FRAME_DATA_CHARS || !JPEG_DATA_URL.test(frame.imageDataUrl)) return false;
      seen.add(frame.id);
      return true;
    });
    if (!frames.length) continue;
    visualFrames.set(sourceKey, {
      sourceKey,
      frames,
      updatedAt: isoDate(record?.updatedAt),
    });
  }
  return { transcripts: [...transcripts.values()], visualFrames: [...visualFrames.values()] };
}

export function summarizeBackup(workspace, sources = { transcripts: [], visualFrames: [] }) {
  const state = parseWorkbenchState(jsonValue(workspace));
  const safeSources = sanitizeBackupSources(sources, state);
  const modules = Object.fromEntries(categories.map((category) => [category.key, category.select(state).length]));
  const transcriptChars = safeSources.transcripts.reduce((total, record) => total + record.transcript.length, 0);
  const frameCount = safeSources.visualFrames.reduce((total, record) => total + record.frames.length, 0);
  const frameBytes = safeSources.visualFrames.reduce((total, record) => total + record.frames.reduce((sum, frame) => sum + Math.floor(frame.imageDataUrl.length * 0.75), 0), 0);
  return {
    workspaceVersion: state.version,
    modules,
    objectCount: Object.values(modules).reduce((total, count) => total + count, 0),
    transcriptCount: safeSources.transcripts.length,
    transcriptChars,
    visualSourceCount: safeSources.visualFrames.length,
    frameCount,
    frameBytes,
  };
}

function compareItems(currentItems, incomingItems) {
  const current = new Map(currentItems.map((item) => [item.id, jsonValue(item)]));
  const incoming = new Map(incomingItems.map((item) => [item.id, jsonValue(item)]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  for (const [id, value] of incoming) {
    if (!current.has(id)) added += 1;
    else if (current.get(id) === value) unchanged += 1;
    else changed += 1;
  }
  for (const id of current.keys()) if (!incoming.has(id)) removed += 1;
  return { added, removed, changed, unchanged };
}

export function compareBackupStates(currentValue, incomingValue) {
  const current = parseWorkbenchState(jsonValue(currentValue));
  const incoming = parseWorkbenchState(jsonValue(incomingValue));
  const rows = categories.map((category) => {
    const currentItems = category.select(current);
    const incomingItems = category.select(incoming);
    return {
      key: category.key,
      label: category.label,
      current: currentItems.length,
      incoming: incomingItems.length,
      ...compareItems(currentItems, incomingItems),
    };
  });
  return {
    rows,
    added: rows.reduce((total, row) => total + row.added, 0),
    removed: rows.reduce((total, row) => total + row.removed, 0),
    changed: rows.reduce((total, row) => total + row.changed, 0),
    unchanged: rows.reduce((total, row) => total + row.unchanged, 0),
    currentVersion: current.version,
    incomingVersion: incoming.version,
  };
}

export async function createBackupEnvelope(workspaceValue, sourceValue, exportedAt = new Date().toISOString()) {
  const workspace = parseWorkbenchState(jsonValue(workspaceValue));
  const sources = sanitizeBackupSources(sourceValue, workspace);
  const payload = { workspace, sources };
  const safeExportedAt = isoDate(exportedAt, new Date().toISOString());
  const content = checksumContent({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    workspaceVersion: workspace.version,
    exportedAt: safeExportedAt,
    payload,
  });
  const envelope = {
    ...content,
    checksumAlgorithm: "SHA-256",
    checksum: await sha256Text(jsonValue(content)),
  };
  if (byteLength(jsonValue(envelope)) > MAX_BACKUP_BYTES) throw new Error("备份超过 96MB 上限，请先清理不再需要的画面资料");
  return envelope;
}

export function serializeBackupEnvelope(envelope) {
  const serialized = JSON.stringify(envelope, null, 2);
  if (byteLength(serialized) > MAX_BACKUP_BYTES) throw new Error("备份超过 96MB 上限，请先清理不再需要的画面资料");
  return `${serialized}\n`;
}

export async function parseBackupText(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("备份文件为空");
  if (byteLength(raw) > MAX_BACKUP_BYTES) throw new Error("备份文件超过 96MB 上限");
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("备份不是有效的 JSON 文件");
  }
  if (!envelope || envelope.format !== BACKUP_FORMAT || envelope.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("这不是受支持的 Evolve Desk 备份格式");
  }
  if (envelope.checksumAlgorithm !== "SHA-256" || !/^[0-9a-f]{64}$/i.test(String(envelope.checksum || ""))) {
    throw new Error("备份缺少有效的完整性校验值");
  }
  if (!envelope.payload || typeof envelope.payload !== "object" || !envelope.payload.workspace) {
    throw new Error("备份缺少工作台数据");
  }
  const sourceVersion = Number(envelope.workspaceVersion);
  const payloadVersion = Number(envelope.payload.workspace.version);
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) throw new Error("备份缺少工作台版本");
  if (!Number.isInteger(payloadVersion) || payloadVersion !== sourceVersion) throw new Error("备份的工作台版本标记不一致");
  if (sourceVersion > CURRENT_WORKSPACE_VERSION) throw new Error("备份来自更新版本的工作台，请先升级应用");
  const exportedAt = isoDate(envelope.exportedAt);
  if (!exportedAt || exportedAt !== envelope.exportedAt) throw new Error("备份缺少有效的导出时间");
  const content = checksumContent({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    workspaceVersion: sourceVersion,
    exportedAt,
    payload: envelope.payload,
  });
  const actualChecksum = await sha256Text(jsonValue(content));
  if (actualChecksum !== String(envelope.checksum).toLowerCase()) throw new Error("备份内容与校验值不一致，可能已损坏或被修改");
  const workspace = parseWorkbenchState(jsonValue(envelope.payload.workspace));
  const sources = sanitizeBackupSources(envelope.payload.sources, workspace);
  return {
    envelope: {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      workspaceVersion: sourceVersion,
      exportedAt,
      checksumAlgorithm: "SHA-256",
      checksum: actualChecksum,
      payload: { workspace, sources },
    },
    workspace,
    sources,
    summary: summarizeBackup(workspace, sources),
  };
}
