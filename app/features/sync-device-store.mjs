import { createSyncIdentity, inspectSyncPacketText } from "./sync-core.mjs";

const DATABASE_NAME = "evolve-desk-sync";
const DATABASE_VERSION = 2;
const IDENTITY_STORE = "identity";
const CHANNEL_STORE = "channels";
const REVISION_STORE = "revisions";
const MAX_REVISIONS_PER_CHANNEL = 4;
export const SYNC_CHANNELS_CHANGED_EVENT = "evolve-desk-sync-channels-changed";

function notifyChannelsChanged() {
  if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.Event === "function") {
    globalThis.dispatchEvent(new globalThis.Event(SYNC_CHANNELS_CHANGED_EVENT));
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本地同步密钥库读取失败"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("本地同步密钥库写入失败"));
    transaction.onabort = () => reject(transaction.error || new Error("本地同步密钥库操作已中止"));
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) return null;
  const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(IDENTITY_STORE)) database.createObjectStore(IDENTITY_STORE, { keyPath: "id" });
    if (!database.objectStoreNames.contains(CHANNEL_STORE)) database.createObjectStore(CHANNEL_STORE, { keyPath: "channelId" });
    if (!database.objectStoreNames.contains(REVISION_STORE)) {
      const revisions = database.createObjectStore(REVISION_STORE, { keyPath: "key" });
      revisions.createIndex("channelId", "channelId", { unique: false });
    }
  };
  return requestResult(request);
}

export async function loadOrCreateSyncIdentity(name = "这台设备") {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const read = database.transaction(IDENTITY_STORE, "readonly");
    const readDone = transactionDone(read);
    const existing = await requestResult(read.objectStore(IDENTITY_STORE).get("local"));
    await readDone;
    if (existing?.cryptoVersion === 2 && existing?.device?.signingPublicKey && existing?.exchangePrivateKey && existing?.signingPrivateKey) {
      return { device: existing.device, exchangePrivateKey: existing.exchangePrivateKey, signingPrivateKey: existing.signingPrivateKey };
    }
    const identity = await createSyncIdentity(name);
    const write = database.transaction([IDENTITY_STORE, CHANNEL_STORE, REVISION_STORE], "readwrite");
    const writeDone = transactionDone(write);
    write.objectStore(IDENTITY_STORE).put({ id: "local", cryptoVersion: 2, ...identity });
    write.objectStore(CHANNEL_STORE).clear();
    write.objectStore(REVISION_STORE).clear();
    await writeDone;
    return identity;
  } finally {
    database.close();
  }
}

export async function renameSyncIdentity(identity, nameValue) {
  const name = String(nameValue || "").trim().slice(0, 60);
  if (!name) throw new Error("设备名称不能为空");
  const updated = { ...identity, device: { ...identity.device, name } };
  const database = await openDatabase();
  if (!database) throw new Error("当前浏览器不支持本地同步密钥库");
  try {
    const transaction = database.transaction(IDENTITY_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(IDENTITY_STORE).put({ id: "local", cryptoVersion: 2, ...updated });
    await done;
    return updated;
  } finally {
    database.close();
  }
}

export async function listSyncChannels() {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(CHANNEL_STORE, "readonly");
    const done = transactionDone(transaction);
    const channels = await requestResult(transaction.objectStore(CHANNEL_STORE).getAll());
    await done;
    return Array.isArray(channels) ? channels : [];
  } finally {
    database.close();
  }
}

export async function saveSyncChannel(channel) {
  if (!channel?.channelId || !channel?.key) throw new Error("同步空间缺少标识或密钥");
  const database = await openDatabase();
  if (!database) throw new Error("当前浏览器不支持本地同步密钥库");
  try {
    const transaction = database.transaction(CHANNEL_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(CHANNEL_STORE).put(channel);
    await done;
    return channel;
  } finally {
    database.close();
  }
}

export async function setSyncChannelHead(channelId, revisionId, lastPacketAt = new Date().toISOString(), mergeParentRevisionIds = []) {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(CHANNEL_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(CHANNEL_STORE);
    const channel = await requestResult(store.get(channelId));
    if (!channel) {
      await done;
      return null;
    }
    const updated = {
      ...channel,
      headRevisionId: String(revisionId || ""),
      lastPacketAt,
      mergeParentRevisionIds: [...new Set((Array.isArray(mergeParentRevisionIds) ? mergeParentRevisionIds : []).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 4),
    };
    store.put(updated);
    await done;
    notifyChannelsChanged();
    return updated;
  } finally {
    database.close();
  }
}

export async function saveSyncRevisionPacket(raw) {
  const packet = inspectSyncPacketText(raw);
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(REVISION_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(REVISION_STORE);
    const previous = await requestResult(store.index("channelId").getAll(packet.channelId));
    const record = {
      key: `${packet.channelId}:${packet.revisionId}`,
      channelId: packet.channelId,
      revisionId: packet.revisionId,
      parentRevisionId: packet.parentRevisionId,
      mergeParentRevisionIds: packet.mergeParentRevisionIds || [],
      createdAt: packet.createdAt,
      packetText: raw,
    };
    store.put(record);
    const retained = [...previous.filter((item) => item.revisionId !== packet.revisionId), record]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_REVISIONS_PER_CHANNEL);
    const retainedKeys = new Set(retained.map((item) => item.key));
    for (const item of [...previous, record]) if (!retainedKeys.has(item.key)) store.delete(item.key);
    await done;
    return true;
  } finally {
    database.close();
  }
}

export async function getSyncRevisionPacket(channelId, revisionId) {
  const channel = String(channelId || "").trim();
  const revision = String(revisionId || "").trim();
  if (!channel || !revision) return null;
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(REVISION_STORE, "readonly");
    const done = transactionDone(transaction);
    const record = await requestResult(transaction.objectStore(REVISION_STORE).get(`${channel}:${revision}`));
    await done;
    return typeof record?.packetText === "string" ? record.packetText : null;
  } finally {
    database.close();
  }
}
