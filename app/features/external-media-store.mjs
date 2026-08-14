const DATABASE_NAME = "evolve-desk-external-media";
const DATABASE_VERSION = 1;
const STORE_NAME = "handles";
const SAMPLE_BYTES = 64 * 1024;
const MAX_SOURCE_KEY_CHARS = 2_000;

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

function normalizeFileMetadata(file) {
  if (!file || typeof file.arrayBuffer !== "function" || typeof file.slice !== "function") throw new Error("没有取得可读取的本地媒体文件");
  const name = String(file.name || "").trim().slice(0, 255);
  const type = String(file.type || "application/octet-stream").trim().slice(0, 160);
  const size = Number(file.size);
  const lastModified = Number(file.lastModified);
  if (!name || !Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(lastModified) || lastModified < 0) throw new Error("本地媒体文件元数据无效");
  return { name, type, size, lastModified };
}

function hex(value) {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
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
  return { sourceKey, handle, ...metadata, fingerprint: await createExternalMediaFingerprint(file), sampleBytes: SAMPLE_BYTES, boundAt };
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
    return { sourceKey: record.sourceKey, name: record.name, type: record.type, size: record.size, lastModified: record.lastModified, fingerprint: record.fingerprint, boundAt: record.boundAt };
  } finally {
    database.close();
  }
}

export async function loadExternalMediaInfo(sourceKeyValue) {
  const sourceKey = normalizeSourceKey(sourceKeyValue);
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(sourceKey));
    await done;
    if (!record) return null;
    return { sourceKey: record.sourceKey, name: record.name, type: record.type, size: record.size, lastModified: record.lastModified, fingerprint: record.fingerprint, boundAt: record.boundAt };
  } finally {
    database.close();
  }
}

export async function openExternalMediaFile(sourceKeyValue) {
  const sourceKey = normalizeSourceKey(sourceKeyValue);
  const database = await openDatabase();
  if (!database) throw new Error("当前浏览器不支持外部媒体索引");
  let record;
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    record = await requestResult(transaction.objectStore(STORE_NAME).get(sourceKey));
    await done;
  } finally {
    database.close();
  }
  if (!record?.handle) throw new Error("这条本地媒体尚未绑定外部原文件");
  let permission = "prompt";
  if (typeof record.handle.queryPermission === "function") permission = await record.handle.queryPermission({ mode: "read" });
  if (permission !== "granted" && typeof record.handle.requestPermission === "function") permission = await record.handle.requestPermission({ mode: "read" });
  if (permission !== "granted") throw new Error("浏览器没有授予外部原文件读取权限");
  const file = await record.handle.getFile();
  if (!await verifyExternalMediaFile(record, file)) throw new Error("外部原文件自绑定后已经变化，请核对后重新绑定");
  return { file, info: { sourceKey: record.sourceKey, name: record.name, type: record.type, size: record.size, lastModified: record.lastModified, fingerprint: record.fingerprint, boundAt: record.boundAt } };
}
