import { MAX_EXTERNAL_MEDIA_BYTES, createExternalMediaFullHash } from "./external-media-hash.mjs";

const DATABASE_NAME = "evolve-desk-external-media";
const DATABASE_VERSION = 1;
const STORE_NAME = "handles";
const RECORD_VERSION = 2;
const SAMPLE_BYTES = 64 * 1024;
const MAX_SOURCE_KEY_CHARS = 2_000;
const MAX_BATCH_ITEMS = 256;
export const EXTERNAL_MEDIA_INDEX_CHANGED_EVENT = "evolve-desk-external-media-changed";

function notifyIndexChanged() {
  if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.Event === "function") {
    globalThis.dispatchEvent(new globalThis.Event(EXTERNAL_MEDIA_INDEX_CHANGED_EVENT));
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("外部媒体索引读取失败"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("外部媒体索引写入失败"));
    transaction.onabort = () => reject(transaction.error || new Error("外部媒体索引操作已中止"));
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) return null;
  const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "sourceKey" });
  };
  return requestResult(request);
}

function normalizeSourceKey(value) {
  const sourceKey = String(value || "").trim().slice(0, MAX_SOURCE_KEY_CHARS);
  if (!/^local-media:\/\/[A-Za-z0-9._~-]{8,200}$/.test(sourceKey)) throw new Error("外部原文件只能绑定到已保存的本地媒体来源");
  return sourceKey;
}

function normalizeSourceKeys(values) {
  const sourceKeys = [...new Set((Array.isArray(values) ? values : []).map(normalizeSourceKey))];
  if (sourceKeys.length > MAX_BATCH_ITEMS) throw new Error("一次最多维护 256 条外部媒体索引");
  return sourceKeys;
}

function normalizeFileMetadata(file) {
  if (!file || typeof file.arrayBuffer !== "function" || typeof file.slice !== "function") throw new Error("没有取得可读取的本地媒体文件");
  const name = String(file.name || "").trim().slice(0, 255);
  const type = String(file.type || "application/octet-stream").trim().slice(0, 160);
  const size = Number(file.size);
  const lastModified = Number(file.lastModified);
  if (!name || !Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(lastModified) || lastModified < 0) throw new Error("本地媒体文件元数据无效");
  if (size > MAX_EXTERNAL_MEDIA_BYTES) throw new Error("外部原文件超过 500MB 安全上限");
  return { name, type, size, lastModified };
}

function normalizeIsoDate(value) {
  const candidate = String(value || "").trim().slice(0, 40);
  return candidate && Number.isFinite(new Date(candidate).getTime()) ? new Date(candidate).toISOString() : "";
}

function normalizeHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : "";
}

function infoFromRecord(record) {
  return {
    sourceKey: record.sourceKey,
    name: String(record.name || ""),
    type: String(record.type || "application/octet-stream"),
    size: Number(record.size) || 0,
    lastModified: Number(record.lastModified) || 0,
    fingerprint: normalizeHash(record.fingerprint),
    boundAt: normalizeIsoDate(record.boundAt),
    fullHash: normalizeHash(record.fullHash),
    fullHashAt: normalizeIsoDate(record.fullHashAt),
    relocatedAt: normalizeIsoDate(record.relocatedAt),
  };
}

function hex(value) {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function listRecords() {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    await done;
    return Array.isArray(records) ? records : [];
  } finally {
    database.close();
  }
}

async function loadRecord(sourceKeyValue) {
  const sourceKey = normalizeSourceKey(sourceKeyValue);
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(sourceKey));
    await done;
    return record || null;
  } finally {
    database.close();
  }
}

async function permissionForHandle(handle, requestPermission) {
  let permission = "unknown";
  if (typeof handle?.queryPermission === "function") {
    try {
      permission = await handle.queryPermission({ mode: "read" });
    } catch {
      permission = "unknown";
    }
  }
  if (permission !== "granted" && requestPermission && typeof handle?.requestPermission === "function") {
    try {
      permission = await handle.requestPermission({ mode: "read" });
    } catch {
      permission = "denied";
    }
  }
  return permission;
}

export function supportsExternalMediaHandles() {
  return Boolean(globalThis.indexedDB && typeof globalThis.showOpenFilePicker === "function");
}

export async function createExternalMediaFingerprint(file) {
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持外部媒体指纹校验");
  const metadata = normalizeFileMetadata(file);
  const first = new Uint8Array(await file.slice(0, Math.min(SAMPLE_BYTES, metadata.size)).arrayBuffer());
  const tailOffset = Math.max(first.byteLength, metadata.size - SAMPLE_BYTES);
  const last = tailOffset < metadata.size ? new Uint8Array(await file.slice(tailOffset, metadata.size).arrayBuffer()) : new Uint8Array();
  const header = new TextEncoder().encode(JSON.stringify({ ...metadata, sampleBytes: SAMPLE_BYTES }));
  const input = new Uint8Array(header.byteLength + 1 + first.byteLength + last.byteLength);
  input.set(header, 0);
  input[header.byteLength] = 0;
  input.set(first, header.byteLength + 1);
  input.set(last, header.byteLength + 1 + first.byteLength);
  return hex(await globalThis.crypto.subtle.digest("SHA-256", input));
}

export async function createExternalMediaRecord(sourceKeyValue, file, handle, boundAtValue = new Date().toISOString()) {
  const sourceKey = normalizeSourceKey(sourceKeyValue);
  const metadata = normalizeFileMetadata(file);
  const boundAt = new Date(boundAtValue).toISOString();
  if (!handle || handle.kind !== "file" || typeof handle.getFile !== "function") throw new Error("浏览器没有返回可持久化的文件句柄");
  return {
    recordVersion: RECORD_VERSION,
    sourceKey,
    handle,
    ...metadata,
    fingerprint: await createExternalMediaFingerprint(file),
    sampleBytes: SAMPLE_BYTES,
    boundAt,
    fullHash: "",
    fullHashAt: "",
    relocatedAt: "",
  };
}

export async function verifyExternalMediaFile(record, file) {
  const metadata = normalizeFileMetadata(file);
  const expected = record && typeof record === "object" ? record : {};
  if (metadata.name !== expected.name || metadata.size !== expected.size || metadata.lastModified !== expected.lastModified) return false;
  return await createExternalMediaFingerprint(file) === expected.fingerprint;
}

export async function saveExternalMediaHandle(sourceKey, handle) {
  const file = await handle?.getFile?.();
  const record = await createExternalMediaRecord(sourceKey, file, handle);
  const database = await openDatabase();
  if (!database) throw new Error("当前浏览器不支持外部媒体索引");
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(record);
    await done;
    notifyIndexChanged();
    return infoFromRecord(record);
  } finally {
    database.close();
  }
}

export async function listExternalMediaInfo() {
  return (await listRecords()).map(infoFromRecord).sort((left, right) => right.boundAt.localeCompare(left.boundAt));
}

export async function loadExternalMediaInfo(sourceKeyValue) {
  const record = await loadRecord(sourceKeyValue);
  return record ? infoFromRecord(record) : null;
}

async function inspectRecordHealth(record, validSourceKeys) {
  const info = infoFromRecord(record);
  const checkedAt = new Date().toISOString();
  if (validSourceKeys && !validSourceKeys.has(info.sourceKey)) {
    return { ...info, status: "orphaned", permission: "unknown", checkedAt, detail: "对应的本地视频记录已经不存在" };
  }
  if (!record?.handle || record.handle.kind !== "file" || typeof record.handle.getFile !== "function") {
    return { ...info, status: "missing", permission: "unknown", checkedAt, detail: "文件句柄缺失或浏览器已无法读取" };
  }
  const permission = await permissionForHandle(record.handle, false);
  if (permission === "prompt" || permission === "denied") {
    return { ...info, status: "permission", permission, checkedAt, detail: permission === "denied" ? "读取权限已拒绝" : "需要再次授予读取权限" };
  }
  try {
    const file = await record.handle.getFile();
    const verified = await verifyExternalMediaFile(record, file);
    return verified
      ? { ...info, status: "ready", permission: permission === "unknown" ? "granted" : permission, checkedAt, detail: info.fullHash ? "采样指纹一致，已保存完整哈希" : "名称、元数据与首尾采样一致" }
      : { ...info, status: "changed", permission: permission === "unknown" ? "granted" : permission, checkedAt, detail: "文件自绑定后发生变化，需要重新定位或核对" };
  } catch (error) {
    return { ...info, status: "missing", permission, checkedAt, detail: error instanceof Error ? error.message : "文件已经移动、删除或不可读取" };
  }
}

export async function scanExternalMediaIndex(validSourceKeysValue) {
  const validSourceKeys = Array.isArray(validSourceKeysValue) ? new Set(normalizeSourceKeys(validSourceKeysValue)) : null;
  const records = await listRecords();
  const health = [];
  for (const record of records) health.push(await inspectRecordHealth(record, validSourceKeys));
  return health.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export async function openExternalMediaFile(sourceKeyValue) {
  const record = await loadRecord(sourceKeyValue);
  if (!record?.handle) throw new Error("这条本地媒体尚未绑定外部原文件");
  const permission = await permissionForHandle(record.handle, true);
  if (permission !== "granted" && typeof record.handle.queryPermission === "function") throw new Error("浏览器没有授予外部原文件读取权限");
  const file = await record.handle.getFile();
  if (!await verifyExternalMediaFile(record, file)) throw new Error("外部原文件自绑定后已经变化，请核对后重新绑定");
  return { file, info: infoFromRecord(record) };
}

export async function calculateExternalMediaFullHash(sourceKeyValue, onProgress, control) {
  const sourceKey = normalizeSourceKey(sourceKeyValue);
  const record = await loadRecord(sourceKey);
  if (!record?.handle) throw new Error("这条本地媒体尚未绑定外部原文件");
  const permission = await permissionForHandle(record.handle, true);
  if (permission !== "granted" && typeof record.handle.queryPermission === "function") throw new Error("浏览器没有授予外部原文件读取权限");
  const file = await record.handle.getFile();
  if (!await verifyExternalMediaFile(record, file)) throw new Error("文件已经变化，不能把新内容的完整哈希写到旧索引");
  const fullHash = await createExternalMediaFullHash(file, onProgress, control);
  const fullHashAt = new Date().toISOString();
  const database = await openDatabase();
  if (!database) throw new Error("当前浏览器不支持外部媒体索引");
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const current = await requestResult(store.get(sourceKey));
    if (!current || current.fingerprint !== record.fingerprint || current.boundAt !== record.boundAt) throw new Error("计算完整哈希期间索引已经变化，请重新扫描");
    const updated = { ...current, recordVersion: RECORD_VERSION, fullHash, fullHashAt };
    store.put(updated);
    await done;
    notifyIndexChanged();
    return infoFromRecord(updated);
  } finally {
    database.close();
  }
}

export function createExternalMediaDuplicateReport(recordsValue) {
  const records = Array.isArray(recordsValue) ? recordsValue : [];
  const buckets = new Map();
  const seenSourceKeys = new Set();
  let hashedRecords = 0;
  for (const record of records) {
    const fullHash = normalizeHash(record?.fullHash);
    const size = Number(record?.size);
    if (!fullHash || !Number.isSafeInteger(size) || size < 1 || size > MAX_EXTERNAL_MEDIA_BYTES) continue;
    const sourceKey = String(record?.sourceKey || "");
    const name = String(record?.name || "").trim().slice(0, 255);
    if (!/^local-media:\/\/[A-Za-z0-9._~-]{8,200}$/.test(sourceKey) || seenSourceKeys.has(sourceKey) || !name) continue;
    seenSourceKeys.add(sourceKey);
    hashedRecords += 1;
    const key = `${size}:${fullHash}`;
    const bucket = buckets.get(key) || { fullHash, size, records: [] };
    bucket.records.push({ sourceKey, name });
    buckets.set(key, bucket);
  }
  const groups = [...buckets.values()]
    .filter((group) => group.records.length > 1)
    .map((group) => ({ ...group, records: group.records.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")) }))
    .sort((left, right) => right.size - left.size || left.fullHash.localeCompare(right.fullHash));
  return {
    hashedRecords,
    duplicateRecords: groups.reduce((total, group) => total + group.records.length, 0),
    groups,
  };
}

function exactRelocationMatch(record, candidate) {
  if (record.name !== candidate.name || record.size !== candidate.size || record.lastModified !== candidate.lastModified || record.fingerprint !== candidate.fingerprint) return false;
  return !record.fullHash || record.fullHash === candidate.fullHash;
}

function fullRelocationMatch(record, candidate) {
  return Boolean(record.fullHash && candidate.fullHash && record.size === candidate.size && record.fullHash === candidate.fullHash);
}

export function planExternalMediaRelocations(recordsValue, candidatesValue) {
  const records = Array.isArray(recordsValue) ? recordsValue : [];
  const candidates = Array.isArray(candidatesValue) ? candidatesValue : [];
  const remainingRecords = new Set(records.map((record) => record.sourceKey));
  const remainingCandidates = new Set(candidates.map((candidate) => candidate.candidateId));
  const matches = [];
  function assignUnique(method, predicate) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of records) {
        if (!remainingRecords.has(record.sourceKey)) continue;
        const possible = candidates.filter((candidate) => remainingCandidates.has(candidate.candidateId) && predicate(record, candidate));
        if (possible.length !== 1) continue;
        const candidate = possible[0];
        const reverse = records.filter((other) => remainingRecords.has(other.sourceKey) && predicate(other, candidate));
        if (reverse.length !== 1) continue;
        matches.push({ sourceKey: record.sourceKey, candidateId: candidate.candidateId, method });
        remainingRecords.delete(record.sourceKey);
        remainingCandidates.delete(candidate.candidateId);
        changed = true;
      }
    }
  }
  assignUnique("sample", exactRelocationMatch);
  assignUnique("full", fullRelocationMatch);
  assignUnique("sample", exactRelocationMatch);
  return { matches, unresolvedSourceKeys: [...remainingRecords], unmatchedCandidateIds: [...remainingCandidates] };
}

export async function relocateExternalMediaHandles(sourceKeysValue, handlesValue, onProgress) {
  const sourceKeys = normalizeSourceKeys(sourceKeysValue);
  const handles = Array.isArray(handlesValue) ? handlesValue : [];
  if (!sourceKeys.length) throw new Error("请先选择需要重新定位的索引");
  if (!handles.length) throw new Error("没有选择用于重新定位的文件");
  if (handles.length > MAX_BATCH_ITEMS) throw new Error("一次最多核对 256 个候选文件");
  const records = (await listRecords()).filter((record) => sourceKeys.includes(record.sourceKey));
  if (records.length !== sourceKeys.length) throw new Error("部分待重新定位索引已经不存在，请重新扫描");
  const infos = records.map(infoFromRecord);
  const candidates = [];
  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    if (!handle || handle.kind !== "file" || typeof handle.getFile !== "function") throw new Error("文件选择器返回了无效句柄");
    const file = await handle.getFile();
    const metadata = normalizeFileMetadata(file);
    const fingerprint = await createExternalMediaFingerprint(file);
    let fullHash = "";
    if (infos.some((record) => record.fullHash && record.size === metadata.size)) {
      fullHash = await createExternalMediaFullHash(file, (processedBytes, totalBytes) => {
        if (typeof onProgress === "function") onProgress({ fileIndex: index + 1, fileCount: handles.length, fileName: metadata.name, processedBytes, totalBytes });
      });
    }
    candidates.push({ candidateId: `candidate_${index}`, handle, ...metadata, fingerprint, fullHash });
  }
  const plan = planExternalMediaRelocations(infos, candidates);
  if (!plan.matches.length) return { matched: [], unresolvedSourceKeys: plan.unresolvedSourceKeys, unmatchedFiles: candidates.map((candidate) => candidate.name) };
  const relocatedAt = new Date().toISOString();
  const recordByKey = new Map(records.map((record) => [record.sourceKey, record]));
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const updates = plan.matches.map((match) => {
    const record = recordByKey.get(match.sourceKey);
    const candidate = candidateById.get(match.candidateId);
    return {
      ...record,
      recordVersion: RECORD_VERSION,
      handle: candidate.handle,
      name: candidate.name,
      type: candidate.type,
      size: candidate.size,
      lastModified: candidate.lastModified,
      fingerprint: candidate.fingerprint,
      sampleBytes: SAMPLE_BYTES,
      fullHash: candidate.fullHash || "",
      fullHashAt: candidate.fullHash ? relocatedAt : "",
      relocatedAt,
    };
  });
  const database = await openDatabase();
  if (!database) throw new Error("当前浏览器不支持外部媒体索引");
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    for (const updated of updates) store.put(updated);
    await done;
    notifyIndexChanged();
  } finally {
    database.close();
  }
  const unmatchedIds = new Set(plan.unmatchedCandidateIds);
  return {
    matched: plan.matches.map((match) => ({ sourceKey: match.sourceKey, name: candidateById.get(match.candidateId).name, method: match.method })),
    unresolvedSourceKeys: plan.unresolvedSourceKeys,
    unmatchedFiles: candidates.filter((candidate) => unmatchedIds.has(candidate.candidateId)).map((candidate) => candidate.name),
  };
}

export async function removeExternalMediaHandles(sourceKeysValue) {
  const sourceKeys = normalizeSourceKeys(sourceKeysValue);
  if (!sourceKeys.length) return 0;
  const database = await openDatabase();
  if (!database) throw new Error("当前浏览器不支持外部媒体索引");
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    for (const sourceKey of sourceKeys) store.delete(sourceKey);
    await done;
    notifyIndexChanged();
    return sourceKeys.length;
  } finally {
    database.close();
  }
}
