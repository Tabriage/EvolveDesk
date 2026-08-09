const DATABASE_NAME = "evolve-desk.sources.v1";
const STORE_NAME = "transcripts";
const MAX_TRANSCRIPT_CHARS = 100_000;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("本地字幕存储失败")), { once: true });
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) return null;
  const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "sourceKey" });
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
