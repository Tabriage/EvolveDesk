import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MAX_BACKUP_BYTES,
  parseBackupText,
  sha256Text,
} from "./backup-core.mjs";

export const SYNC_PAIRING_FORMAT = "evolve-desk.sync-pairing";
export const SYNC_GRANT_FORMAT = "evolve-desk.sync-grant";
export const SYNC_PACKET_FORMAT = "evolve-desk.sync-packet";
export const SYNC_FORMAT_VERSION = 1;
export const MAX_SYNC_CONTROL_BYTES = 128 * 1024;
export const MAX_SYNC_PACKET_BYTES = 132 * 1024 * 1024;
export const PAIRING_LIFETIME_MS = 24 * 60 * 60 * 1_000;

const AES_KEY_BITS = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const GCM_TAG_BITS = 128;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;
const SAFE_ID = /^[A-Za-z0-9_-]{8,100}$/;

function requireCrypto() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("当前浏览器不支持设备授权所需的本地加密能力");
  }
  return globalThis.crypto;
}

function text(value, limit = 100) {
  return String(value || "").trim().slice(0, limit);
}

function isoDate(value) {
  const candidate = text(value, 40);
  return Number.isFinite(new Date(candidate).getTime()) ? new Date(candidate).toISOString() : "";
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ""));
}

function randomId(prefix) {
  const crypto = requireCrypto();
  const value = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : [...crypto.getRandomValues(new Uint8Array(16))].map((part) => part.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${value}`;
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return globalThis.btoa(chunks.join(""));
}

function base64Bytes(value, expectedBytes = null) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new Error("同步文件包含无效的二进制字段");
  }
  let decoded;
  try {
    decoded = globalThis.atob(value);
  } catch {
    throw new Error("同步文件包含无效的二进制字段");
  }
  if (expectedBytes !== null && decoded.length !== expectedBytes) throw new Error("同步文件的随机参数长度无效");
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function decodedBase64Length(value) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new Error("同步密文不是有效的 Base64");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function normalizePublicKey(value, keyOps = []) {
  const key = value && typeof value === "object" ? value : {};
  if (key.kty !== "EC" || key.crv !== "P-256" || typeof key.x !== "string" || typeof key.y !== "string") {
    throw new Error("设备公钥格式无效");
  }
  if (!BASE64_URL.test(key.x) || !BASE64_URL.test(key.y) || key.x.length !== 43 || key.y.length !== 43 || "d" in key) {
    throw new Error("设备公钥参数无效");
  }
  return { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true, key_ops: keyOps };
}

async function publicKeyFingerprint(exchangePublicKeyValue, signingPublicKeyValue) {
  const exchange = normalizePublicKey(exchangePublicKeyValue);
  const signing = normalizePublicKey(signingPublicKeyValue, ["verify"]);
  return sha256Text(JSON.stringify({
    exchange: { kty: exchange.kty, crv: exchange.crv, x: exchange.x, y: exchange.y },
    signing: { kty: signing.kty, crv: signing.crv, x: signing.x, y: signing.y },
  }));
}

async function normalizePublicDevice(value) {
  const source = value && typeof value === "object" ? value : {};
  const deviceId = text(source.deviceId, 100);
  const name = text(source.name, 60);
  const createdAt = isoDate(source.createdAt);
  if (!SAFE_ID.test(deviceId) || !name || !createdAt || createdAt !== source.createdAt) throw new Error("设备身份信息无效");
  const exchangePublicKey = normalizePublicKey(source.exchangePublicKey);
  const signingPublicKey = normalizePublicKey(source.signingPublicKey, ["verify"]);
  const fingerprint = await publicKeyFingerprint(exchangePublicKey, signingPublicKey);
  if (source.fingerprint !== fingerprint) throw new Error("设备公钥指纹不一致");
  return { deviceId, name, createdAt, exchangePublicKey, signingPublicKey, fingerprint };
}

async function importExchangePublicKey(value) {
  return requireCrypto().subtle.importKey(
    "jwk",
    normalizePublicKey(value),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

async function importSigningPublicKey(value) {
  return requireCrypto().subtle.importKey(
    "jwk",
    normalizePublicKey(value, ["verify"]),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function normalizeProof(value) {
  if (value?.name !== "ECDSA" || value?.hash !== "SHA-256") throw new Error("设备签名参数不受支持");
  base64Bytes(value.signature, 64);
  return { name: "ECDSA", hash: "SHA-256", signature: value.signature };
}

async function signContent(privateKey, value) {
  if (!privateKey) throw new Error("当前设备缺少本地签名私钥");
  const signature = await requireCrypto().subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, textBytes(value));
  return { name: "ECDSA", hash: "SHA-256", signature: bytesToBase64(signature) };
}

async function verifyContent(publicKeyValue, proofValue, value, errorMessage) {
  const proof = normalizeProof(proofValue);
  const publicKey = await importSigningPublicKey(publicKeyValue);
  const verified = await requireCrypto().subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, base64Bytes(proof.signature, 64), textBytes(value));
  if (!verified) throw new Error(errorMessage);
  return proof;
}

async function deriveGrantKey(privateKey, publicKeyValue, salt, info) {
  const crypto = requireCrypto();
  const publicKey = await importExchangePublicKey(publicKeyValue);
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const context = await crypto.subtle.digest("SHA-256", textBytes(info));
  return crypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt,
    info: context,
  }, material, { name: "AES-GCM", length: AES_KEY_BITS }, false, ["encrypt", "decrypt"]);
}

function pairingContent(value) {
  return {
    format: SYNC_PAIRING_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    requestId: value.requestId,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    device: value.device,
  };
}

async function validatePairingRequest(value, now = new Date()) {
  if (!value || typeof value !== "object" || value.format !== SYNC_PAIRING_FORMAT) throw new Error("这不是 Evolve Desk 设备授权请求");
  if (value.formatVersion !== SYNC_FORMAT_VERSION) throw new Error("设备授权请求版本不受支持");
  const requestId = text(value.requestId, 100);
  const createdAt = isoDate(value.createdAt);
  const expiresAt = isoDate(value.expiresAt);
  if (!SAFE_ID.test(requestId) || !createdAt || createdAt !== value.createdAt || !expiresAt || expiresAt !== value.expiresAt) {
    throw new Error("设备授权请求时间或标识无效");
  }
  const lifetime = new Date(expiresAt).getTime() - new Date(createdAt).getTime();
  if (lifetime <= 0 || lifetime > PAIRING_LIFETIME_MS) throw new Error("设备授权请求有效期无效");
  if (new Date(expiresAt).getTime() <= now.getTime()) throw new Error("设备授权请求已过期，请在目标设备重新生成");
  const device = await normalizePublicDevice(value.device);
  const content = pairingContent({ requestId, createdAt, expiresAt, device });
  const proof = await verifyContent(device.signingPublicKey, value.proof, JSON.stringify(content), "设备授权请求签名无效，可能已被替换");
  return { ...content, proof };
}

export function formatDeviceFingerprint(value) {
  const fingerprint = text(value, 64).toUpperCase();
  return fingerprint.match(/.{1,4}/g)?.join(" ") || "";
}

export async function createSyncIdentity(nameValue = "这台设备", createdAtValue = new Date().toISOString()) {
  const crypto = requireCrypto();
  const name = text(nameValue, 60);
  const createdAt = isoDate(createdAtValue);
  if (!name) throw new Error("请为这台设备填写名称");
  if (!createdAt) throw new Error("设备创建时间无效");
  const exchangePair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const signingPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const exchangePublicKey = normalizePublicKey(await crypto.subtle.exportKey("jwk", exchangePair.publicKey));
  const signingPublicKey = normalizePublicKey(await crypto.subtle.exportKey("jwk", signingPair.publicKey), ["verify"]);
  const device = {
    deviceId: randomId("device"),
    name,
    createdAt,
    exchangePublicKey,
    signingPublicKey,
    fingerprint: await publicKeyFingerprint(exchangePublicKey, signingPublicKey),
  };
  return { device, exchangePrivateKey: exchangePair.privateKey, signingPrivateKey: signingPair.privateKey };
}

export async function createPairingRequest(identity, createdAtValue = new Date().toISOString()) {
  const device = await normalizePublicDevice(identity?.device);
  if (!identity?.exchangePrivateKey || !identity?.signingPrivateKey) throw new Error("当前设备缺少本地私钥");
  const createdAt = isoDate(createdAtValue);
  if (!createdAt) throw new Error("授权请求时间无效");
  const expiresAt = new Date(new Date(createdAt).getTime() + PAIRING_LIFETIME_MS).toISOString();
  const content = pairingContent({ requestId: randomId("pair"), createdAt, expiresAt, device });
  return { ...content, proof: await signContent(identity.signingPrivateKey, JSON.stringify(content)) };
}

export function serializePairingRequest(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(serialized) > MAX_SYNC_CONTROL_BYTES) throw new Error("设备授权请求过大");
  return serialized;
}

export async function inspectPairingRequestText(raw, now = new Date()) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_SYNC_CONTROL_BYTES) throw new Error("设备授权请求文件为空或过大");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("设备授权请求不是有效的 JSON 文件");
  }
  return validatePairingRequest(value, now);
}

export async function createSyncChannel(identity, labelValue = "我的工作台", createdAtValue = new Date().toISOString()) {
  const crypto = requireCrypto();
  const device = await normalizePublicDevice(identity?.device);
  const label = text(labelValue, 60);
  const createdAt = isoDate(createdAtValue);
  if (!label || !createdAt) throw new Error("同步空间名称或时间无效");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: AES_KEY_BITS }, true, ["encrypt", "decrypt"]);
  return {
    channelId: randomId("channel"),
    label,
    createdAt,
    ownerDeviceId: device.deviceId,
    role: "owner",
    key,
    authorizedDevices: [{ ...device, authorizedAt: createdAt, authorizedBy: device.deviceId }],
    headRevisionId: "",
    lastPacketAt: "",
  };
}

function grantHeader(value) {
  return {
    format: SYNC_GRANT_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    grantId: value.grantId,
    requestId: value.requestId,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    channel: value.channel,
    grantor: value.grantor,
    recipient: value.recipient,
    keyAgreement: { name: "ECDH", namedCurve: "P-256", kdf: "HKDF-SHA-256", salt: value.keyAgreement.salt },
    cipher: { name: "AES-GCM", keyLength: AES_KEY_BITS, iv: value.cipher.iv, tagLength: GCM_TAG_BITS },
  };
}

async function validateGrant(value, now = new Date()) {
  if (!value || typeof value !== "object" || value.format !== SYNC_GRANT_FORMAT) throw new Error("这不是 Evolve Desk 设备授权回执");
  if (value.formatVersion !== SYNC_FORMAT_VERSION) throw new Error("设备授权回执版本不受支持");
  const grantId = text(value.grantId, 100);
  const requestId = text(value.requestId, 100);
  const issuedAt = isoDate(value.issuedAt);
  const expiresAt = isoDate(value.expiresAt);
  const channelId = text(value.channel?.channelId, 100);
  const label = text(value.channel?.label, 60);
  const createdAt = isoDate(value.channel?.createdAt);
  if (!SAFE_ID.test(grantId) || !SAFE_ID.test(requestId) || !issuedAt || issuedAt !== value.issuedAt || !expiresAt || expiresAt !== value.expiresAt) throw new Error("设备授权回执标识或时间无效");
  const lifetime = new Date(expiresAt).getTime() - new Date(issuedAt).getTime();
  if (lifetime <= 0 || lifetime > PAIRING_LIFETIME_MS || new Date(expiresAt).getTime() <= now.getTime()) throw new Error("设备授权回执已过期");
  if (!SAFE_ID.test(channelId) || !label || !createdAt || createdAt !== value.channel?.createdAt) throw new Error("同步空间信息无效");
  const grantor = await normalizePublicDevice(value.grantor);
  const recipient = await normalizePublicDevice(value.recipient);
  if (value.keyAgreement?.name !== "ECDH" || value.keyAgreement?.namedCurve !== "P-256" || value.keyAgreement?.kdf !== "HKDF-SHA-256") throw new Error("授权回执的密钥协商参数不受支持");
  base64Bytes(value.keyAgreement.salt, SALT_BYTES);
  if (value.cipher?.name !== "AES-GCM" || value.cipher?.keyLength !== AES_KEY_BITS || value.cipher?.tagLength !== GCM_TAG_BITS) throw new Error("授权回执的加密参数不受支持");
  base64Bytes(value.cipher.iv, IV_BYTES);
  if (decodedBase64Length(value.ciphertext) !== AES_KEY_BITS / 8 + GCM_TAG_BITS / 8) throw new Error("授权回执的密文长度无效");
  const unsigned = { ...grantHeader({
    grantId,
    requestId,
    issuedAt,
    expiresAt,
    channel: { channelId, label, createdAt },
    grantor,
    recipient,
    keyAgreement: { salt: value.keyAgreement.salt },
    cipher: { iv: value.cipher.iv },
  }), ciphertext: value.ciphertext };
  const proof = await verifyContent(grantor.signingPublicKey, value.proof, JSON.stringify(unsigned), "设备授权回执签名无效，可能已被替换");
  return { ...unsigned, proof };
}

export async function createDeviceGrant(channel, identity, pairingValue, issuedAtValue = new Date().toISOString()) {
  const crypto = requireCrypto();
  const pairing = await validatePairingRequest(pairingValue, new Date(issuedAtValue));
  const grantor = await normalizePublicDevice(identity?.device);
  if (channel?.role !== "owner" || channel?.ownerDeviceId !== grantor.deviceId) throw new Error("只有同步空间的创建设备可以授权新设备");
  if (!channel?.key || !SAFE_ID.test(text(channel.channelId, 100))) throw new Error("当前同步空间缺少本地密钥");
  if (pairing.device.deviceId === grantor.deviceId) throw new Error("不能再次授权当前设备");
  const issuedAt = isoDate(issuedAtValue);
  if (!issuedAt) throw new Error("设备授权时间无效");
  const expiresAt = pairing.expiresAt;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = grantHeader({
    grantId: randomId("grant"),
    requestId: pairing.requestId,
    issuedAt,
    expiresAt,
    channel: { channelId: channel.channelId, label: text(channel.label, 60), createdAt: channel.createdAt },
    grantor,
    recipient: pairing.device,
    keyAgreement: { salt: bytesToBase64(salt) },
    cipher: { iv: bytesToBase64(iv) },
  });
  const wrapKey = await deriveGrantKey(identity.exchangePrivateKey, pairing.device.exchangePublicKey, salt, JSON.stringify(header));
  const channelSecret = await crypto.subtle.exportKey("raw", channel.key);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: textBytes(JSON.stringify(header)), tagLength: GCM_TAG_BITS }, wrapKey, channelSecret);
  const authorized = { ...pairing.device, authorizedAt: issuedAt, authorizedBy: grantor.deviceId };
  const authorizedDevices = [...(Array.isArray(channel.authorizedDevices) ? channel.authorizedDevices : []).filter((device) => device.deviceId !== authorized.deviceId), authorized];
  const unsigned = { ...header, ciphertext: bytesToBase64(ciphertext) };
  const proof = await signContent(identity.signingPrivateKey, JSON.stringify(unsigned));
  return { grant: { ...unsigned, proof }, channel: { ...channel, authorizedDevices } };
}

export function serializeDeviceGrant(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(serialized) > MAX_SYNC_CONTROL_BYTES) throw new Error("设备授权回执过大");
  return serialized;
}

export async function inspectDeviceGrantText(raw, now = new Date()) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_SYNC_CONTROL_BYTES) throw new Error("设备授权回执文件为空或过大");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("设备授权回执不是有效的 JSON 文件");
  }
  return validateGrant(value, now);
}

export async function acceptDeviceGrant(grantValue, identity, acceptedAtValue = new Date().toISOString()) {
  const crypto = requireCrypto();
  const acceptedAt = isoDate(acceptedAtValue);
  if (!acceptedAt) throw new Error("接受授权的时间无效");
  const grant = await validateGrant(grantValue, new Date(acceptedAt));
  const device = await normalizePublicDevice(identity?.device);
  if (grant.recipient.deviceId !== device.deviceId || grant.recipient.fingerprint !== device.fingerprint) throw new Error("这份授权回执不属于当前设备");
  if (!identity?.exchangePrivateKey) throw new Error("当前设备缺少本地私钥");
  const salt = base64Bytes(grant.keyAgreement.salt, SALT_BYTES);
  const iv = base64Bytes(grant.cipher.iv, IV_BYTES);
  const header = grantHeader(grant);
  const wrapKey = await deriveGrantKey(identity.exchangePrivateKey, grant.grantor.exchangePublicKey, salt, JSON.stringify(header));
  let channelSecret;
  try {
    channelSecret = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: textBytes(JSON.stringify(header)), tagLength: GCM_TAG_BITS }, wrapKey, base64Bytes(grant.ciphertext));
  } catch {
    throw new Error("设备授权回执无法解锁，可能已被修改或不属于当前请求");
  }
  if (channelSecret.byteLength !== AES_KEY_BITS / 8) throw new Error("同步空间密钥长度无效");
  const key = await crypto.subtle.importKey("raw", channelSecret, { name: "AES-GCM", length: AES_KEY_BITS }, false, ["encrypt", "decrypt"]);
  return {
    channelId: grant.channel.channelId,
    label: grant.channel.label,
    createdAt: grant.channel.createdAt,
    ownerDeviceId: grant.grantor.deviceId,
    role: "member",
    key,
    authorizedDevices: [
      { ...grant.grantor, authorizedAt: grant.issuedAt, authorizedBy: grant.grantor.deviceId },
      { ...device, authorizedAt: acceptedAt, authorizedBy: grant.grantor.deviceId },
    ],
    headRevisionId: "",
    lastPacketAt: "",
  };
}

function packetHeader(value) {
  return {
    format: SYNC_PACKET_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    channelId: value.channelId,
    revisionId: value.revisionId,
    parentRevisionId: value.parentRevisionId,
    createdAt: value.createdAt,
    author: value.author,
    innerFormat: BACKUP_FORMAT,
    innerFormatVersion: BACKUP_FORMAT_VERSION,
    cipher: { name: "AES-GCM", keyLength: AES_KEY_BITS, iv: value.cipher.iv, tagLength: GCM_TAG_BITS },
  };
}

function validatePacket(value) {
  if (!value || typeof value !== "object" || value.format !== SYNC_PACKET_FORMAT) throw new Error("这不是 Evolve Desk 加密同步包");
  if (value.formatVersion !== SYNC_FORMAT_VERSION) throw new Error("同步包版本不受支持");
  const channelId = text(value.channelId, 100);
  const revisionId = text(value.revisionId, 100);
  const parentRevisionId = text(value.parentRevisionId, 100);
  const createdAt = isoDate(value.createdAt);
  const author = { deviceId: text(value.author?.deviceId, 100), fingerprint: text(value.author?.fingerprint, 64) };
  if (!SAFE_ID.test(channelId) || !SAFE_ID.test(revisionId) || (parentRevisionId && !SAFE_ID.test(parentRevisionId))) throw new Error("同步包版本链标识无效");
  if (!createdAt || createdAt !== value.createdAt || !SAFE_ID.test(author.deviceId) || !/^[0-9a-f]{64}$/i.test(author.fingerprint)) throw new Error("同步包作者或时间无效");
  if (value.innerFormat !== BACKUP_FORMAT || value.innerFormatVersion !== BACKUP_FORMAT_VERSION) throw new Error("同步包内层迁移卷标记无效");
  if (value.cipher?.name !== "AES-GCM" || value.cipher?.keyLength !== AES_KEY_BITS || value.cipher?.tagLength !== GCM_TAG_BITS) throw new Error("同步包的加密参数不受支持");
  base64Bytes(value.cipher.iv, IV_BYTES);
  const encryptedBytes = decodedBase64Length(value.ciphertext);
  if (encryptedBytes < GCM_TAG_BITS / 8 || encryptedBytes > MAX_BACKUP_BYTES + GCM_TAG_BITS / 8) throw new Error("同步包的密文大小无效");
  const proof = normalizeProof(value.proof);
  return { ...packetHeader({ channelId, revisionId, parentRevisionId, createdAt, author, cipher: { iv: value.cipher.iv } }), ciphertext: value.ciphertext, proof };
}

export function classifySyncRevision(headRevisionIdValue, packetValue) {
  const headRevisionId = text(headRevisionIdValue, 100);
  const packet = validatePacket(packetValue);
  if (!headRevisionId) return "initial";
  if (packet.revisionId === headRevisionId) return "duplicate";
  if (packet.parentRevisionId === headRevisionId) return "forward";
  return "diverged";
}

export async function createSyncPacket(backupText, channel, identity, createdAtValue = new Date().toISOString()) {
  const crypto = requireCrypto();
  await parseBackupText(backupText);
  const device = await normalizePublicDevice(identity?.device);
  const trusted = (Array.isArray(channel?.authorizedDevices) ? channel.authorizedDevices : []).find((candidate) => candidate.deviceId === device.deviceId && candidate.fingerprint === device.fingerprint);
  if (!trusted) throw new Error("当前设备未被这个同步空间授权");
  if (!channel?.key || !SAFE_ID.test(text(channel.channelId, 100))) throw new Error("当前同步空间缺少本地密钥");
  const createdAt = isoDate(createdAtValue);
  if (!createdAt) throw new Error("同步包创建时间无效");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = packetHeader({
    channelId: channel.channelId,
    revisionId: randomId("revision"),
    parentRevisionId: text(channel.headRevisionId, 100),
    createdAt,
    author: { deviceId: device.deviceId, fingerprint: device.fingerprint },
    cipher: { iv: bytesToBase64(iv) },
  });
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: textBytes(JSON.stringify(header)), tagLength: GCM_TAG_BITS }, channel.key, textBytes(backupText));
  const unsigned = { ...header, ciphertext: bytesToBase64(ciphertext) };
  return { ...unsigned, proof: await signContent(identity?.signingPrivateKey, JSON.stringify(unsigned)) };
}

export function serializeSyncPacket(value) {
  const packet = validatePacket(value);
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  if (byteLength(serialized) > MAX_SYNC_PACKET_BYTES) throw new Error("同步包超过 132MB 上限");
  return serialized;
}

export function inspectSyncPacketText(raw) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_SYNC_PACKET_BYTES) throw new Error("同步包文件为空或超过 132MB 上限");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("同步包不是有效的 JSON 文件");
  }
  return validatePacket(value);
}

export async function decryptSyncPacket(packetValue, channel) {
  const crypto = requireCrypto();
  const packet = validatePacket(packetValue);
  if (packet.channelId !== channel?.channelId) throw new Error("同步包不属于当前设备已加入的同步空间");
  if (!channel?.key) throw new Error("当前同步空间缺少本地密钥");
  const author = (Array.isArray(channel.authorizedDevices) ? channel.authorizedDevices : []).find((device) => device.deviceId === packet.author.deviceId && device.fingerprint === packet.author.fingerprint);
  if (!author) throw new Error("同步包来自当前设备尚未信任的设备");
  const header = packetHeader(packet);
  await verifyContent(author.signingPublicKey, packet.proof, JSON.stringify({ ...header, ciphertext: packet.ciphertext }), "同步包设备签名无效，可能已被冒充或修改");
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(packet.cipher.iv, IV_BYTES), additionalData: textBytes(JSON.stringify(header)), tagLength: GCM_TAG_BITS }, channel.key, base64Bytes(packet.ciphertext));
  } catch {
    throw new Error("同步包无法解锁，可能已损坏、被修改或密钥不匹配");
  }
  const backupText = new TextDecoder().decode(plaintext);
  const parsed = await parseBackupText(backupText);
  return { packet, author, backupText, parsed, relation: classifySyncRevision(channel.headRevisionId, packet) };
}
