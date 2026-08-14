import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MAX_BACKUP_BYTES,
  parseBackupText,
  sha256Text,
} from "./backup-core.mjs";
import { BACKUP_KDF_ITERATIONS, validateBackupPassphrase } from "./backup-crypto.mjs";

export const SYNC_PAIRING_FORMAT = "evolve-desk.sync-pairing";
export const SYNC_GRANT_FORMAT = "evolve-desk.sync-grant";
export const SYNC_ROTATION_FORMAT = "evolve-desk.sync-rotation";
export const SYNC_RECOVERY_FORMAT = "evolve-desk.sync-recovery";
export const SYNC_OWNERSHIP_TRANSFER_FORMAT = "evolve-desk.sync-ownership-transfer";
export const SYNC_PACKET_FORMAT = "evolve-desk.sync-packet";
export const SYNC_FORMAT_VERSION = 1;
export const SYNC_PACKET_FORMAT_VERSION = 2;
export const MAX_SYNC_CONTROL_BYTES = 128 * 1024;
export const MAX_SYNC_RECOVERY_BYTES = 512 * 1024;
export const MAX_SYNC_PACKET_BYTES = 132 * 1024 * 1024;
export const PAIRING_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const SYNC_RECOVERY_KDF_ITERATIONS = BACKUP_KDF_ITERATIONS;

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

async function deriveRecoveryKey(passphrase, salt) {
  const crypto = requireCrypto();
  const material = await crypto.subtle.importKey("raw", textBytes(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: SYNC_RECOVERY_KDF_ITERATIONS,
    salt,
  }, material, { name: "AES-GCM", length: AES_KEY_BITS }, false, ["encrypt", "decrypt"]);
}

function normalizeRecoveryPrivateKey(value, publicKeyValue) {
  const source = value && typeof value === "object" ? value : {};
  const publicKey = normalizePublicKey(publicKeyValue, ["verify"]);
  if (source.kty !== "EC" || source.crv !== "P-256" || source.x !== publicKey.x || source.y !== publicKey.y || typeof source.d !== "string" || source.d.length !== 43 || !BASE64_URL.test(source.d)) {
    throw new Error("离线恢复私钥与所有者授权不一致");
  }
  return { kty: "EC", crv: "P-256", x: source.x, y: source.y, d: source.d, ext: true, key_ops: ["sign"] };
}

async function recoveryAuthority(value) {
  const signingPublicKey = normalizePublicKey(value?.signingPublicKey, ["verify"]);
  const fingerprint = await sha256Text(JSON.stringify({
    kty: signingPublicKey.kty,
    crv: signingPublicKey.crv,
    x: signingPublicKey.x,
    y: signingPublicKey.y,
  }));
  if (text(value?.fingerprint, 64) !== fingerprint) throw new Error("离线恢复授权公钥指纹不一致");
  return { signingPublicKey, fingerprint };
}

async function normalizeAuthorizedDevice(value) {
  const device = await normalizePublicDevice(value);
  const authorizedAt = isoDate(value?.authorizedAt);
  const authorizedBy = text(value?.authorizedBy, 100);
  if (!authorizedAt || authorizedAt !== value?.authorizedAt || !SAFE_ID.test(authorizedBy)) throw new Error("离线恢复材料的授权设备记录无效");
  return { ...device, authorizedAt, authorizedBy };
}

function recoveryChannel(value) {
  const channelId = text(value?.channelId, 100);
  const label = text(value?.label, 60);
  const createdAt = isoDate(value?.createdAt);
  const generation = Number(value?.generation);
  const previousChannelId = text(value?.previousChannelId, 100);
  const headRevisionId = text(value?.headRevisionId, 100);
  if (!SAFE_ID.test(channelId) || !label || !createdAt || createdAt !== value?.createdAt) throw new Error("离线恢复材料的同步空间信息无效");
  if (!Number.isSafeInteger(generation) || generation < 1 || generation >= 999_999 || (generation > 1 && !SAFE_ID.test(previousChannelId)) || (generation === 1 && previousChannelId)) {
    throw new Error("离线恢复材料的空间世代无效");
  }
  if (headRevisionId && !SAFE_ID.test(headRevisionId)) throw new Error("离线恢复材料的版本头无效");
  return { channelId, label, createdAt, generation, previousChannelId, headRevisionId };
}

function recoveryDelegationContent(value) {
  return {
    recoveryId: value.recoveryId,
    createdAt: value.createdAt,
    channel: value.channel,
    owner: value.owner,
    authority: value.authority,
  };
}

async function validateRecoveryDelegation(value) {
  const recoveryId = text(value?.recoveryId, 100);
  const createdAt = isoDate(value?.createdAt);
  if (!SAFE_ID.test(recoveryId) || !createdAt || createdAt !== value?.createdAt) throw new Error("离线恢复授权标识或时间无效");
  const channel = recoveryChannel(value.channel);
  const owner = await normalizePublicDevice(value.owner);
  const authority = await recoveryAuthority(value.authority);
  const content = recoveryDelegationContent({ recoveryId, createdAt, channel, owner, authority });
  const proof = await verifyContent(owner.signingPublicKey, value.proof, JSON.stringify(content), "离线恢复授权签名无效，可能已被替换");
  return { ...content, proof };
}

function recoveryHeader(value) {
  return {
    format: SYNC_RECOVERY_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    delegation: value.delegation,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: SYNC_RECOVERY_KDF_ITERATIONS,
      salt: value.kdf.salt,
    },
    cipher: {
      name: "AES-GCM",
      keyLength: AES_KEY_BITS,
      iv: value.cipher.iv,
      tagLength: GCM_TAG_BITS,
    },
  };
}

async function validateRecoveryEnvelope(value) {
  if (!value || typeof value !== "object" || value.format !== SYNC_RECOVERY_FORMAT) throw new Error("这不是 Evolve Desk 离线所有者恢复材料");
  if (value.formatVersion !== SYNC_FORMAT_VERSION) throw new Error("离线恢复材料版本不受支持");
  const delegation = await validateRecoveryDelegation(value.delegation);
  if (value.kdf?.name !== "PBKDF2" || value.kdf?.hash !== "SHA-256" || value.kdf?.iterations !== SYNC_RECOVERY_KDF_ITERATIONS) throw new Error("离线恢复材料的口令派生参数不受支持");
  base64Bytes(value.kdf.salt, SALT_BYTES);
  if (value.cipher?.name !== "AES-GCM" || value.cipher?.keyLength !== AES_KEY_BITS || value.cipher?.tagLength !== GCM_TAG_BITS) throw new Error("离线恢复材料的加密参数不受支持");
  base64Bytes(value.cipher.iv, IV_BYTES);
  const encryptedBytes = decodedBase64Length(value.ciphertext);
  if (encryptedBytes < GCM_TAG_BITS / 8 || encryptedBytes > MAX_SYNC_RECOVERY_BYTES) throw new Error("离线恢复材料的密文大小无效");
  return { ...recoveryHeader({ delegation, kdf: value.kdf, cipher: value.cipher }), ciphertext: value.ciphertext };
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
    generation: 1,
    previousChannelId: "",
    retiredAt: "",
    rotatedToChannelId: "",
    revokedDeviceIds: [],
    authorizedDevices: [{ ...device, authorizedAt: createdAt, authorizedBy: device.deviceId }],
    headRevisionId: "",
    lastPacketAt: "",
    mergeParentRevisionIds: [],
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
  const hasLineage = value.channel?.generation !== undefined || value.channel?.previousChannelId !== undefined;
  const generation = hasLineage ? Number(value.channel?.generation) : 1;
  const previousChannelId = hasLineage ? text(value.channel?.previousChannelId, 100) : "";
  if (!SAFE_ID.test(grantId) || !SAFE_ID.test(requestId) || !issuedAt || issuedAt !== value.issuedAt || !expiresAt || expiresAt !== value.expiresAt) throw new Error("设备授权回执标识或时间无效");
  const lifetime = new Date(expiresAt).getTime() - new Date(issuedAt).getTime();
  if (lifetime <= 0 || lifetime > PAIRING_LIFETIME_MS || new Date(expiresAt).getTime() <= now.getTime()) throw new Error("设备授权回执已过期");
  if (!SAFE_ID.test(channelId) || !label || !createdAt || createdAt !== value.channel?.createdAt) throw new Error("同步空间信息无效");
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 1_000_000 || (generation > 1 && !SAFE_ID.test(previousChannelId)) || (generation === 1 && previousChannelId)) {
    throw new Error("同步空间世代信息无效");
  }
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
    channel: { channelId, label, createdAt, ...(hasLineage ? { generation, previousChannelId } : {}) },
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
  if (channel?.retiredAt) throw new Error("旧同步空间已因密钥轮换停用，不能继续授权设备");
  if (!channel?.key || !SAFE_ID.test(text(channel.channelId, 100))) throw new Error("当前同步空间缺少本地密钥");
  if (pairing.device.deviceId === grantor.deviceId) throw new Error("不能再次授权当前设备");
  if ((Array.isArray(channel.revokedDeviceIds) ? channel.revokedDeviceIds : []).includes(pairing.device.deviceId)) throw new Error("这台设备已被空间密钥轮换撤销，不能重新授权");
  const issuedAt = isoDate(issuedAtValue);
  if (!issuedAt) throw new Error("设备授权时间无效");
  const generation = Number(channel.generation) || 1;
  const previousChannelId = text(channel.previousChannelId, 100);
  if (!Number.isSafeInteger(generation) || generation < 1 || generation > 1_000_000 || (generation > 1 && !SAFE_ID.test(previousChannelId)) || (generation === 1 && previousChannelId)) {
    throw new Error("当前同步空间世代信息无效");
  }
  const expiresAt = pairing.expiresAt;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = grantHeader({
    grantId: randomId("grant"),
    requestId: pairing.requestId,
    issuedAt,
    expiresAt,
    channel: {
      channelId: channel.channelId,
      label: text(channel.label, 60),
      createdAt: channel.createdAt,
      generation,
      previousChannelId,
    },
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
    generation: Number(grant.channel.generation) || 1,
    previousChannelId: text(grant.channel.previousChannelId, 100),
    retiredAt: "",
    rotatedToChannelId: "",
    revokedDeviceIds: [],
    authorizedDevices: [
      { ...grant.grantor, authorizedAt: grant.issuedAt, authorizedBy: grant.grantor.deviceId },
      { ...device, authorizedAt: acceptedAt, authorizedBy: grant.grantor.deviceId },
    ],
    headRevisionId: "",
    lastPacketAt: "",
    mergeParentRevisionIds: [],
  };
}

function rotationDevice(value) {
  return { deviceId: value.deviceId, fingerprint: value.fingerprint };
}

function normalizeRotationDevice(value) {
  const deviceId = text(value?.deviceId, 100);
  const fingerprint = text(value?.fingerprint, 64);
  if (!SAFE_ID.test(deviceId) || !/^[0-9a-f]{64}$/i.test(fingerprint)) throw new Error("空间轮换设备清单无效");
  return { deviceId, fingerprint };
}

function rotationContent(value) {
  return {
    format: SYNC_ROTATION_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    rotationId: value.rotationId,
    rotatedAt: value.rotatedAt,
    previous: value.previous,
    next: value.next,
    owner: value.owner,
    revoked: value.revoked,
    retained: value.retained,
  };
}

async function validateSyncRotation(value) {
  if (!value || typeof value !== "object" || value.format !== SYNC_ROTATION_FORMAT) throw new Error("这不是 Evolve Desk 空间轮换记录");
  if (value.formatVersion !== SYNC_FORMAT_VERSION) throw new Error("空间轮换记录版本不受支持");
  const rotationId = text(value.rotationId, 100);
  const rotatedAt = isoDate(value.rotatedAt);
  const previous = {
    channelId: text(value.previous?.channelId, 100),
    generation: Number(value.previous?.generation),
    headRevisionId: text(value.previous?.headRevisionId, 100),
  };
  const next = {
    channelId: text(value.next?.channelId, 100),
    generation: Number(value.next?.generation),
    label: text(value.next?.label, 60),
  };
  if (!SAFE_ID.test(rotationId) || !rotatedAt || rotatedAt !== value.rotatedAt) throw new Error("空间轮换记录标识或时间无效");
  if (!SAFE_ID.test(previous.channelId) || !Number.isSafeInteger(previous.generation) || previous.generation < 1 || previous.generation > 999_999) throw new Error("旧同步空间世代无效");
  if (previous.headRevisionId && !SAFE_ID.test(previous.headRevisionId)) throw new Error("旧同步空间版本头无效");
  if (!SAFE_ID.test(next.channelId) || next.channelId === previous.channelId || next.generation !== previous.generation + 1 || !next.label) throw new Error("新同步空间世代无效");
  const owner = await normalizePublicDevice(value.owner);
  const revoked = Array.isArray(value.revoked) ? value.revoked.map(normalizeRotationDevice) : [];
  const retained = Array.isArray(value.retained) ? value.retained.map(normalizeRotationDevice) : [];
  if (revoked.length > 64 || retained.length > 64 || !revoked.length) throw new Error("空间轮换必须明确至少一台撤销设备");
  const listed = [...revoked, ...retained];
  if (listed.some((device) => device.deviceId === owner.deviceId) || new Set(listed.map((device) => device.deviceId)).size !== listed.length) {
    throw new Error("空间轮换设备清单重复或包含创建设备");
  }
  const content = rotationContent({ rotationId, rotatedAt, previous, next, owner, revoked, retained });
  const proof = await verifyContent(owner.signingPublicKey, value.proof, JSON.stringify(content), "空间轮换记录签名无效，可能已被替换");
  return { ...content, proof };
}

export async function rotateSyncChannel(channel, identity, revokedDeviceIdsValue, rotatedAtValue = new Date().toISOString()) {
  const owner = await normalizePublicDevice(identity?.device);
  if (channel?.role !== "owner" || channel?.ownerDeviceId !== owner.deviceId) throw new Error("只有同步空间的创建设备可以轮换空间密钥");
  if (channel?.retiredAt) throw new Error("这个同步空间已经停用，不能再次轮换");
  if (!channel?.key || !SAFE_ID.test(text(channel.channelId, 100))) throw new Error("当前同步空间缺少本地密钥");
  const rotatedAt = isoDate(rotatedAtValue);
  if (!rotatedAt) throw new Error("空间轮换时间无效");
  const devices = await Promise.all((Array.isArray(channel.authorizedDevices) ? channel.authorizedDevices : []).map(normalizePublicDevice));
  const deviceById = new Map(devices.map((device) => [device.deviceId, device]));
  if (deviceById.get(owner.deviceId)?.fingerprint !== owner.fingerprint) throw new Error("创建设备不在当前同步空间信任清单中");
  const revokedDeviceIds = [...new Set((Array.isArray(revokedDeviceIdsValue) ? revokedDeviceIdsValue : []).map((item) => text(item, 100)).filter(Boolean))];
  if (!revokedDeviceIds.length || revokedDeviceIds.some((deviceId) => deviceId === owner.deviceId || !deviceById.has(deviceId))) {
    throw new Error("请选择至少一台当前已授权的非创建设备进行撤销");
  }
  const previousGeneration = Number.isSafeInteger(channel.generation) && channel.generation > 0 ? channel.generation : 1;
  if (previousGeneration >= 999_999) throw new Error("同步空间世代已达到上限");
  const nextChannel = await createSyncChannel(identity, channel.label, rotatedAt);
  nextChannel.generation = previousGeneration + 1;
  nextChannel.previousChannelId = channel.channelId;
  nextChannel.revokedDeviceIds = [...new Set([...(Array.isArray(channel.revokedDeviceIds) ? channel.revokedDeviceIds : []), ...revokedDeviceIds])];
  const revoked = revokedDeviceIds.map((deviceId) => rotationDevice(deviceById.get(deviceId)));
  const retained = devices.filter((device) => device.deviceId !== owner.deviceId && !revokedDeviceIds.includes(device.deviceId)).map(rotationDevice);
  const content = rotationContent({
    rotationId: randomId("rotation"),
    rotatedAt,
    previous: { channelId: channel.channelId, generation: previousGeneration, headRevisionId: text(channel.headRevisionId, 100) },
    next: { channelId: nextChannel.channelId, generation: nextChannel.generation, label: nextChannel.label },
    owner,
    revoked,
    retained,
  });
  const rotation = { ...content, proof: await signContent(identity?.signingPrivateKey, JSON.stringify(content)) };
  const retiredChannel = { ...channel, retiredAt: rotatedAt, rotatedToChannelId: nextChannel.channelId };
  return { rotation, retiredChannel, nextChannel };
}

export function serializeSyncRotation(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(serialized) > MAX_SYNC_CONTROL_BYTES) throw new Error("空间轮换记录过大");
  return serialized;
}

export async function inspectSyncRotationText(raw) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_SYNC_CONTROL_BYTES) throw new Error("空间轮换记录为空或过大");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("空间轮换记录不是有效的 JSON 文件");
  }
  return validateSyncRotation(value);
}

export async function acceptSyncRotation(rotationValue, channel, identity) {
  const rotation = await validateSyncRotation(rotationValue);
  const device = await normalizePublicDevice(identity?.device);
  if (channel?.channelId !== rotation.previous.channelId || channel?.ownerDeviceId !== rotation.owner.deviceId) throw new Error("空间轮换记录不属于当前旧同步空间");
  const channelGeneration = Number.isSafeInteger(channel.generation) && channel.generation > 0 ? channel.generation : 1;
  if (channelGeneration !== rotation.previous.generation) throw new Error("空间轮换记录与本地旧世代不一致");
  if (channel.retiredAt && channel.rotatedToChannelId !== rotation.next.channelId) throw new Error("本地旧空间已经指向另一份轮换结果");
  const trustedOwner = (Array.isArray(channel.authorizedDevices) ? channel.authorizedDevices : []).find((candidate) => candidate.deviceId === rotation.owner.deviceId && candidate.fingerprint === rotation.owner.fingerprint);
  if (!trustedOwner) throw new Error("空间轮换记录的创建设备不在当前信任清单中");
  const revoked = rotation.revoked.some((candidate) => candidate.deviceId === device.deviceId && candidate.fingerprint === device.fingerprint);
  const retained = rotation.retained.some((candidate) => candidate.deviceId === device.deviceId && candidate.fingerprint === device.fingerprint);
  if (!revoked && !retained) throw new Error("当前设备不在这份空间轮换清单中");
  return {
    status: revoked ? "revoked" : "reauthorize",
    channel: { ...channel, retiredAt: rotation.rotatedAt, rotatedToChannelId: rotation.next.channelId },
    rotation,
  };
}

export async function createSyncRecoveryKit(channel, identity, passphraseValue, createdAtValue = new Date().toISOString()) {
  const crypto = requireCrypto();
  const passphrase = validateBackupPassphrase(passphraseValue);
  const owner = await normalizePublicDevice(identity?.device);
  if (channel?.role !== "owner" || channel?.ownerDeviceId !== owner.deviceId) throw new Error("只有当前同步空间的创建设备可以生成离线恢复材料");
  if (channel?.retiredAt) throw new Error("旧同步空间已经停用，不能生成恢复材料");
  if (!channel?.key || !channel.key.extractable) throw new Error("当前空间密钥不能包装进离线恢复材料");
  const createdAt = isoDate(createdAtValue);
  if (!createdAt) throw new Error("离线恢复材料创建时间无效");
  const channelInfo = recoveryChannel({
    channelId: channel.channelId,
    label: channel.label,
    createdAt: channel.createdAt,
    generation: Number(channel.generation) || 1,
    previousChannelId: channel.previousChannelId || "",
    headRevisionId: channel.headRevisionId || "",
  });
  const authorizedDevices = await Promise.all((Array.isArray(channel.authorizedDevices) ? channel.authorizedDevices : []).map(normalizeAuthorizedDevice));
  if (!authorizedDevices.length || authorizedDevices.length > 64 || new Set(authorizedDevices.map((device) => device.deviceId)).size !== authorizedDevices.length || !authorizedDevices.some((device) => device.deviceId === owner.deviceId && device.fingerprint === owner.fingerprint)) {
    throw new Error("创建设备不在当前空间授权清单中");
  }
  const revokedDeviceIds = [...new Set((Array.isArray(channel.revokedDeviceIds) ? channel.revokedDeviceIds : []).map((item) => text(item, 100)))];
  if (revokedDeviceIds.length > 64 || revokedDeviceIds.some((item) => !SAFE_ID.test(item))) throw new Error("当前空间撤销清单无效");
  const recoveryPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const signingPublicKey = normalizePublicKey(await crypto.subtle.exportKey("jwk", recoveryPair.publicKey), ["verify"]);
  const authority = {
    signingPublicKey,
    fingerprint: await sha256Text(JSON.stringify({ kty: signingPublicKey.kty, crv: signingPublicKey.crv, x: signingPublicKey.x, y: signingPublicKey.y })),
  };
  const delegationContent = recoveryDelegationContent({
    recoveryId: randomId("recovery"),
    createdAt,
    channel: channelInfo,
    owner,
    authority,
  });
  const delegation = { ...delegationContent, proof: await signContent(identity?.signingPrivateKey, JSON.stringify(delegationContent)) };
  const channelSecret = await crypto.subtle.exportKey("raw", channel.key);
  const authorityPrivateKey = normalizeRecoveryPrivateKey(await crypto.subtle.exportKey("jwk", recoveryPair.privateKey), signingPublicKey);
  const payload = JSON.stringify({
    format: "evolve-desk.sync-recovery-secret",
    formatVersion: SYNC_FORMAT_VERSION,
    recoveryId: delegation.recoveryId,
    channelSecret: bytesToBase64(channelSecret),
    authorityPrivateKey,
    authorizedDevices,
    revokedDeviceIds,
  });
  if (byteLength(payload) + GCM_TAG_BITS / 8 > MAX_SYNC_RECOVERY_BYTES) throw new Error("离线恢复材料的加密内容过大");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = recoveryHeader({ delegation, kdf: { salt: bytesToBase64(salt) }, cipher: { iv: bytesToBase64(iv) } });
  const key = await deriveRecoveryKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: textBytes(JSON.stringify(header)), tagLength: GCM_TAG_BITS }, key, textBytes(payload));
  return { ...header, ciphertext: bytesToBase64(ciphertext) };
}

export function serializeSyncRecoveryKit(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(serialized) > MAX_SYNC_RECOVERY_BYTES) throw new Error("离线恢复材料超过大小上限");
  return serialized;
}

export async function inspectSyncRecoveryKitText(raw) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_SYNC_RECOVERY_BYTES) throw new Error("离线恢复材料为空或过大");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("离线恢复材料不是有效的 JSON 文件");
  }
  return validateRecoveryEnvelope(value);
}

async function unlockSyncRecoveryKit(value, passphraseValue) {
  const envelope = await validateRecoveryEnvelope(value);
  const passphrase = validateBackupPassphrase(passphraseValue);
  const salt = base64Bytes(envelope.kdf.salt, SALT_BYTES);
  const iv = base64Bytes(envelope.cipher.iv, IV_BYTES);
  const key = await deriveRecoveryKey(passphrase, salt);
  let plaintext;
  try {
    plaintext = await requireCrypto().subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: textBytes(JSON.stringify(recoveryHeader(envelope))),
      tagLength: GCM_TAG_BITS,
    }, key, base64Bytes(envelope.ciphertext));
  } catch {
    throw new Error("恢复口令不正确，或离线恢复材料已被修改");
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    throw new Error("离线恢复材料解锁后不是有效的恢复内容");
  }
  if (payload?.format !== "evolve-desk.sync-recovery-secret" || payload?.formatVersion !== SYNC_FORMAT_VERSION || payload.recoveryId !== envelope.delegation.recoveryId) {
    throw new Error("离线恢复材料的内外授权不一致");
  }
  const channelSecret = base64Bytes(payload.channelSecret, AES_KEY_BITS / 8);
  const channelKey = await requireCrypto().subtle.importKey("raw", channelSecret, { name: "AES-GCM", length: AES_KEY_BITS }, false, ["encrypt", "decrypt"]);
  const privateJwk = normalizeRecoveryPrivateKey(payload.authorityPrivateKey, envelope.delegation.authority.signingPublicKey);
  const authorityPrivateKey = await requireCrypto().subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const authorizedDevices = await Promise.all((Array.isArray(payload.authorizedDevices) ? payload.authorizedDevices : []).map(normalizeAuthorizedDevice));
  if (!authorizedDevices.length || authorizedDevices.length > 64 || new Set(authorizedDevices.map((device) => device.deviceId)).size !== authorizedDevices.length || !authorizedDevices.some((device) => device.deviceId === envelope.delegation.owner.deviceId && device.fingerprint === envelope.delegation.owner.fingerprint)) {
    throw new Error("离线恢复材料缺少原创建设备授权记录");
  }
  const revokedDeviceIds = [...new Set((Array.isArray(payload.revokedDeviceIds) ? payload.revokedDeviceIds : []).map((item) => text(item, 100)))];
  if (revokedDeviceIds.length > 64 || revokedDeviceIds.some((item) => !SAFE_ID.test(item))) throw new Error("离线恢复材料的撤销清单无效");
  return { envelope, channelKey, authorityPrivateKey, authorizedDevices, revokedDeviceIds };
}

function ownershipTransferContent(value) {
  return {
    format: SYNC_OWNERSHIP_TRANSFER_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    transferId: value.transferId,
    transferredAt: value.transferredAt,
    recoveryId: value.recoveryId,
    previous: value.previous,
    next: value.next,
    previousOwner: value.previousOwner,
    nextOwner: value.nextOwner,
    retained: value.retained,
    delegation: value.delegation,
  };
}

async function validateSyncOwnershipTransfer(value) {
  if (!value || typeof value !== "object" || value.format !== SYNC_OWNERSHIP_TRANSFER_FORMAT) throw new Error("这不是 Evolve Desk 所有权迁移记录");
  if (value.formatVersion !== SYNC_FORMAT_VERSION) throw new Error("所有权迁移记录版本不受支持");
  const transferId = text(value.transferId, 100);
  const transferredAt = isoDate(value.transferredAt);
  const recoveryId = text(value.recoveryId, 100);
  if (!SAFE_ID.test(transferId) || !transferredAt || transferredAt !== value.transferredAt || !SAFE_ID.test(recoveryId)) throw new Error("所有权迁移记录标识或时间无效");
  const delegation = await validateRecoveryDelegation(value.delegation);
  if (delegation.recoveryId !== recoveryId || new Date(transferredAt).getTime() < new Date(delegation.createdAt).getTime()) throw new Error("所有权迁移记录与离线授权不一致");
  const previous = {
    channelId: text(value.previous?.channelId, 100),
    generation: Number(value.previous?.generation),
    headRevisionId: text(value.previous?.headRevisionId, 100),
  };
  const next = { channelId: text(value.next?.channelId, 100), generation: Number(value.next?.generation), label: text(value.next?.label, 60) };
  if (previous.channelId !== delegation.channel.channelId || previous.generation !== delegation.channel.generation || !SAFE_ID.test(previous.headRevisionId)) throw new Error("所有权迁移记录的旧空间证据无效");
  if (!SAFE_ID.test(next.channelId) || next.channelId === previous.channelId || next.generation !== previous.generation + 1 || next.label !== delegation.channel.label) throw new Error("所有权迁移记录的新空间世代无效");
  const previousOwner = await normalizePublicDevice(value.previousOwner);
  const nextOwner = await normalizePublicDevice(value.nextOwner);
  if (previousOwner.deviceId !== delegation.owner.deviceId || previousOwner.fingerprint !== delegation.owner.fingerprint || nextOwner.deviceId === previousOwner.deviceId) {
    throw new Error("所有权迁移记录的新旧所有者无效");
  }
  const retained = Array.isArray(value.retained) ? value.retained.map(normalizeRotationDevice) : [];
  if (retained.length > 64 || new Set(retained.map((device) => device.deviceId)).size !== retained.length || retained.some((device) => device.deviceId === previousOwner.deviceId || device.deviceId === nextOwner.deviceId)) {
    throw new Error("所有权迁移记录的保留设备清单无效");
  }
  const content = ownershipTransferContent({ transferId, transferredAt, recoveryId, previous, next, previousOwner, nextOwner, retained, delegation });
  const proof = await verifyContent(delegation.authority.signingPublicKey, value.proof, JSON.stringify(content), "所有权迁移记录的恢复授权签名无效，可能已被替换");
  return { ...content, proof };
}

export async function recoverSyncOwnership(recoveryValue, passphraseValue, identity, packetText, recoveredAtValue = new Date().toISOString()) {
  const unlocked = await unlockSyncRecoveryKit(recoveryValue, passphraseValue);
  const nextOwner = await normalizePublicDevice(identity?.device);
  const previousOwner = unlocked.envelope.delegation.owner;
  if (nextOwner.deviceId === previousOwner.deviceId || nextOwner.fingerprint === previousOwner.fingerprint) throw new Error("原创建设备仍在使用时不应执行所有权恢复");
  const recoveredAt = isoDate(recoveredAtValue);
  if (!recoveredAt || new Date(recoveredAt).getTime() < new Date(unlocked.envelope.delegation.createdAt).getTime()) throw new Error("所有权恢复时间无效");
  if (typeof packetText !== "string" || !packetText.trim() || byteLength(packetText) > MAX_SYNC_PACKET_BYTES) throw new Error("所有权恢复需要一份旧空间的加密同步包");
  const packet = inspectSyncPacketText(packetText);
  const channelInfo = unlocked.envelope.delegation.channel;
  if (packet.channelId !== channelInfo.channelId) throw new Error("加密同步包不属于恢复材料绑定的旧空间");
  if (new Date(packet.createdAt).getTime() > new Date(recoveredAt).getTime()) throw new Error("加密同步包时间晚于本次恢复时间");
  if (packet.revisionId !== channelInfo.headRevisionId && new Date(packet.createdAt).getTime() < new Date(unlocked.envelope.delegation.createdAt).getTime()) {
    throw new Error("加密同步包早于恢复材料且不是其绑定版本，拒绝回退恢复");
  }
  const oldChannel = {
    channelId: channelInfo.channelId,
    label: channelInfo.label,
    createdAt: channelInfo.createdAt,
    ownerDeviceId: previousOwner.deviceId,
    role: "member",
    key: unlocked.channelKey,
    generation: channelInfo.generation,
    previousChannelId: channelInfo.previousChannelId,
    retiredAt: "",
    rotatedToChannelId: "",
    revokedDeviceIds: unlocked.revokedDeviceIds,
    authorizedDevices: unlocked.authorizedDevices,
    headRevisionId: channelInfo.headRevisionId,
    lastPacketAt: "",
    mergeParentRevisionIds: [],
  };
  const recovered = await decryptSyncPacket(packet, oldChannel);
  const nextChannel = await createSyncChannel(identity, channelInfo.label, recoveredAt);
  nextChannel.generation = channelInfo.generation + 1;
  nextChannel.previousChannelId = channelInfo.channelId;
  nextChannel.revokedDeviceIds = [...new Set([...unlocked.revokedDeviceIds, previousOwner.deviceId])];
  const retained = unlocked.authorizedDevices
    .filter((device) => device.deviceId !== previousOwner.deviceId && device.deviceId !== nextOwner.deviceId)
    .map(rotationDevice);
  const content = ownershipTransferContent({
    transferId: randomId("transfer"),
    transferredAt: recoveredAt,
    recoveryId: unlocked.envelope.delegation.recoveryId,
    previous: { channelId: channelInfo.channelId, generation: channelInfo.generation, headRevisionId: packet.revisionId },
    next: { channelId: nextChannel.channelId, generation: nextChannel.generation, label: nextChannel.label },
    previousOwner,
    nextOwner,
    retained,
    delegation: unlocked.envelope.delegation,
  });
  const transfer = { ...content, proof: await signContent(unlocked.authorityPrivateKey, JSON.stringify(content)) };
  const retiredChannel = { ...oldChannel, headRevisionId: "", retiredAt: recoveredAt, rotatedToChannelId: nextChannel.channelId };
  return { transfer, retiredChannel, nextChannel, recovered };
}

export function serializeSyncOwnershipTransfer(value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(serialized) > MAX_SYNC_CONTROL_BYTES) throw new Error("所有权迁移记录过大");
  return serialized;
}

export async function inspectSyncOwnershipTransferText(raw) {
  if (typeof raw !== "string" || !raw.trim() || byteLength(raw) > MAX_SYNC_CONTROL_BYTES) throw new Error("所有权迁移记录为空或过大");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("所有权迁移记录不是有效的 JSON 文件");
  }
  return validateSyncOwnershipTransfer(value);
}

export async function acceptSyncOwnershipTransfer(transferValue, channel, identity) {
  const transfer = await validateSyncOwnershipTransfer(transferValue);
  const device = await normalizePublicDevice(identity?.device);
  if (channel?.channelId !== transfer.previous.channelId || channel?.ownerDeviceId !== transfer.previousOwner.deviceId) throw new Error("所有权迁移记录不属于当前旧同步空间");
  const generation = Number.isSafeInteger(channel.generation) && channel.generation > 0 ? channel.generation : 1;
  if (generation !== transfer.previous.generation) throw new Error("所有权迁移记录与本地旧世代不一致");
  if (channel.retiredAt && channel.rotatedToChannelId !== transfer.next.channelId) throw new Error("本地旧空间已经指向另一份轮换或迁移结果");
  if (channel.headRevisionId && channel.headRevisionId !== transfer.previous.headRevisionId) throw new Error("本地版本头与所有权迁移证据不一致，请先核对旧空间最新同步包");
  const trustedOwner = (Array.isArray(channel.authorizedDevices) ? channel.authorizedDevices : []).find((candidate) => candidate.deviceId === transfer.previousOwner.deviceId && candidate.fingerprint === transfer.previousOwner.fingerprint);
  if (!trustedOwner) throw new Error("迁移记录中的原创建设备不在本地信任清单中");
  const replacedOwner = device.deviceId === transfer.previousOwner.deviceId && device.fingerprint === transfer.previousOwner.fingerprint;
  const retained = transfer.retained.some((candidate) => candidate.deviceId === device.deviceId && candidate.fingerprint === device.fingerprint);
  if (!replacedOwner && !retained) throw new Error("当前设备不在这份所有权迁移记录中");
  return {
    status: replacedOwner ? "owner-replaced" : "reauthorize",
    channel: { ...channel, retiredAt: transfer.transferredAt, rotatedToChannelId: transfer.next.channelId },
    transfer,
  };
}

function packetHeader(value) {
  const lineage = {
    format: SYNC_PACKET_FORMAT,
    formatVersion: value.formatVersion || SYNC_PACKET_FORMAT_VERSION,
    channelId: value.channelId,
    revisionId: value.revisionId,
    parentRevisionId: value.parentRevisionId,
  };
  return {
    ...lineage,
    ...(Array.isArray(value.mergeParentRevisionIds) ? { mergeParentRevisionIds: value.mergeParentRevisionIds } : {}),
    createdAt: value.createdAt,
    author: value.author,
    innerFormat: BACKUP_FORMAT,
    innerFormatVersion: BACKUP_FORMAT_VERSION,
    cipher: { name: "AES-GCM", keyLength: AES_KEY_BITS, iv: value.cipher.iv, tagLength: GCM_TAG_BITS },
  };
}

function validatePacket(value) {
  if (!value || typeof value !== "object" || value.format !== SYNC_PACKET_FORMAT) throw new Error("这不是 Evolve Desk 加密同步包");
  const formatVersion = Number(value.formatVersion);
  if (![1, SYNC_PACKET_FORMAT_VERSION].includes(formatVersion)) throw new Error("同步包版本不受支持");
  const channelId = text(value.channelId, 100);
  const revisionId = text(value.revisionId, 100);
  const parentRevisionId = text(value.parentRevisionId, 100);
  let mergeParentRevisionIds;
  if (formatVersion === SYNC_PACKET_FORMAT_VERSION) {
    if (!Array.isArray(value.mergeParentRevisionIds)) throw new Error("同步包合并父版本格式无效");
    mergeParentRevisionIds = [...new Set(value.mergeParentRevisionIds.map((item) => text(item, 100)))];
    if (mergeParentRevisionIds.length > 4 || mergeParentRevisionIds.some((item) => !SAFE_ID.test(item) || item === revisionId || item === parentRevisionId)) throw new Error("同步包合并父版本标识无效");
  } else if (value.mergeParentRevisionIds !== undefined) throw new Error("旧版同步包不能声明合并父版本");
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
  return { ...packetHeader({ formatVersion, channelId, revisionId, parentRevisionId, ...(mergeParentRevisionIds ? { mergeParentRevisionIds } : {}), createdAt, author, cipher: { iv: value.cipher.iv } }), ciphertext: value.ciphertext, proof };
}

export function classifySyncRevision(headRevisionIdValue, packetValue) {
  const headRevisionId = text(headRevisionIdValue, 100);
  const packet = validatePacket(packetValue);
  if (!headRevisionId) return "initial";
  if (packet.revisionId === headRevisionId) return "duplicate";
  if (packet.parentRevisionId === headRevisionId || packet.mergeParentRevisionIds?.includes(headRevisionId)) return "forward";
  return "diverged";
}

export async function createSyncPacket(backupText, channel, identity, createdAtValue = new Date().toISOString()) {
  const crypto = requireCrypto();
  await parseBackupText(backupText);
  const device = await normalizePublicDevice(identity?.device);
  const trusted = (Array.isArray(channel?.authorizedDevices) ? channel.authorizedDevices : []).find((candidate) => candidate.deviceId === device.deviceId && candidate.fingerprint === device.fingerprint);
  if (!trusted) throw new Error("当前设备未被这个同步空间授权");
  if (channel?.retiredAt) throw new Error("旧同步空间已因密钥轮换停用，不能再生成新同步包");
  if (!channel?.key || !SAFE_ID.test(text(channel.channelId, 100))) throw new Error("当前同步空间缺少本地密钥");
  const createdAt = isoDate(createdAtValue);
  if (!createdAt) throw new Error("同步包创建时间无效");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = packetHeader({
    channelId: channel.channelId,
    revisionId: randomId("revision"),
    parentRevisionId: text(channel.headRevisionId, 100),
    mergeParentRevisionIds: Array.isArray(channel.mergeParentRevisionIds) ? channel.mergeParentRevisionIds : [],
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
