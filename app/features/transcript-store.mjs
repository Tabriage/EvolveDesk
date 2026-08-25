const DATABASE_NAME = "evolve-desk.sources.v1";
const STORE_NAME = "transcripts";
const VISUAL_STORE_NAME = "visualFrames";
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_VISUAL_FRAMES = 8;
const MAX_FRAME_DATA_CHARS = 620_000;
const MAX_SOURCE_RECORDS = 80;
const MAX_SOURCE_KEY_CHARS = 2_000;
const JPEG_DATA_URL = /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]*$/;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("本地字幕存储失败")), { once: true });
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) return null;
  const request = globalThis.indexedDB.open(DATABASE_NAME, 2);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "sourceKey" });
    if (!database.objectStoreNames.contains(VISUAL_STORE_NAME)) database.createObjectStore(VISUAL_STORE_NAME, { keyPath: "sourceKey" });
  }, { once: true });
  return requestResult(request);
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("本地字幕事务已取消")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("本地字幕事务失败")), { once: true });
  });
}

function isoDate(value) {
  const candidate = String(value || "").trim().slice(0, 40);
  return Number.isFinite(new Date(candidate).getTime()) ? new Date(candidate).toISOString() : "";
}

function sanitizeTranscriptRecords(value) {
  const records = new Map();
  for (const record of (Array.isArray(value) ? value : []).slice(-MAX_SOURCE_RECORDS)) {
    const sourceKey = String(record?.sourceKey || "").trim().slice(0, MAX_SOURCE_KEY_CHARS);
    const transcript = String(record?.transcript || "").trim().slice(0, MAX_TRANSCRIPT_CHARS);
    if (!sourceKey || !transcript) continue;
    records.set(sourceKey, { sourceKey, transcript, updatedAt: isoDate(record?.updatedAt) });
  }
  return [...records.values()];
}

function sanitizeFrameRecords(value) {
  const records = new Map();
  for (const record of (Array.isArray(value) ? value : []).slice(-MAX_SOURCE_RECORDS)) {
    const sourceKey = String(record?.sourceKey || "").trim().slice(0, MAX_SOURCE_KEY_CHARS);
    if (!sourceKey) continue;
    const seen = new Set();
    const frames = (Array.isArray(record?.frames) ? record.frames : []).slice(0, MAX_VISUAL_FRAMES).map((frame) => ({
      id: String(frame?.id || "").trim().slice(0, 100),
      imageDataUrl: String(frame?.imageDataUrl || ""),
    })).filter((frame) => {
      if (!frame.id || seen.has(frame.id) || frame.imageDataUrl.length > MAX_FRAME_DATA_CHARS || !JPEG_DATA_URL.test(frame.imageDataUrl)) return false;
      seen.add(frame.id);
      return true;
    });
    if (!frames.length) continue;
    records.set(sourceKey, { sourceKey, frames, updatedAt: isoDate(record?.updatedAt) });
  }
  return [...records.values()];
}

export async function saveTranscript(sourceKey, value) {
  const key = String(sourceKey || "").trim().slice(0, 2_000);
  const transcript = String(value || "").trim().slice(0, MAX_TRANSCRIPT_CHARS);
  if (!key || !transcript) return false;
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ sourceKey: key, transcript, updatedAt: new Date().toISOString() });
    await transactionDone(transaction);
    return true;
  } finally {
    database.close();
  }
}

export async function loadTranscript(sourceKey) {
  const key = String(sourceKey || "").trim().slice(0, 2_000);
  if (!key) return "";
  const database = await openDatabase();
  if (!database) return "";
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(key));
    await transactionDone(transaction);
    return typeof record?.transcript === "string" ? record.transcript.slice(0, MAX_TRANSCRIPT_CHARS) : "";
  } finally {
    database.close();
  }
}

export async function saveVisualFrames(sourceKey, value) {
  const key = String(sourceKey || "").trim().slice(0, 2_000);
  const seen = new Set();
  const frames = (Array.isArray(value) ? value : []).slice(0, MAX_VISUAL_FRAMES).map((frame) => ({
    id: String(frame?.id || "").trim().slice(0, 100),
    imageDataUrl: String(frame?.imageDataUrl || ""),
  })).filter((frame) => {
    if (!frame.id || seen.has(frame.id) || frame.imageDataUrl.length > MAX_FRAME_DATA_CHARS || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]*$/.test(frame.imageDataUrl)) return false;
    seen.add(frame.id);
    return true;
  });
  if (!key || !frames.length) return false;
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(VISUAL_STORE_NAME, "readwrite");
    transaction.objectStore(VISUAL_STORE_NAME).put({ sourceKey: key, frames, updatedAt: new Date().toISOString() });
    await transactionDone(transaction);
    return true;
  } finally {
    database.close();
  }
}

export async function loadVisualFrames(sourceKey) {
  const key = String(sourceKey || "").trim().slice(0, 2_000);
  if (!key) return [];
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(VISUAL_STORE_NAME, "readonly");
    const record = await requestResult(transaction.objectStore(VISUAL_STORE_NAME).get(key));
    await transactionDone(transaction);
    return (Array.isArray(record?.frames) ? record.frames : []).slice(0, MAX_VISUAL_FRAMES).map((frame) => ({
      id: String(frame?.id || "").trim().slice(0, 100),
      imageDataUrl: String(frame?.imageDataUrl || "").slice(0, MAX_FRAME_DATA_CHARS),
    })).filter((frame) => frame.id && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]*$/.test(frame.imageDataUrl));
  } finally {
    database.close();
  }
}

export async function exportSourceArchive() {
  const database = await openDatabase();
  if (!database) return { transcripts: [], visualFrames: [] };
  try {
    const transaction = database.transaction([STORE_NAME, VISUAL_STORE_NAME], "readonly");
    const done = transactionDone(transaction);
    const [transcripts, visualFrames] = await Promise.all([
      requestResult(transaction.objectStore(STORE_NAME).getAll()),
      requestResult(transaction.objectStore(VISUAL_STORE_NAME).getAll()),
    ]);
    await done;
    return {
      transcripts: sanitizeTranscriptRecords(transcripts),
      visualFrames: sanitizeFrameRecords(visualFrames),
    };
  } finally {
    database.close();
  }
}

export async function replaceSourceArchive(value) {
  const source = value && typeof value === "object" ? value : {};
  const transcripts = sanitizeTranscriptRecords(source.transcripts);
  const visualFrames = sanitizeFrameRecords(source.visualFrames);
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction([STORE_NAME, VISUAL_STORE_NAME], "readwrite");
    const done = transactionDone(transaction);
    const transcriptStore = transaction.objectStore(STORE_NAME);
    const frameStore = transaction.objectStore(VISUAL_STORE_NAME);
    transcriptStore.clear();
    frameStore.clear();
    for (const record of transcripts) transcriptStore.put(record);
    for (const record of visualFrames) frameStore.put(record);
    await done;
    return true;
  } finally {
    database.close();
  }
}
