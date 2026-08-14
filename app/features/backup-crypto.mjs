import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MAX_BACKUP_BYTES,
  parseBackupText,
} from "./backup-core.mjs";

export const ENCRYPTED_BACKUP_FORMAT = "evolve-desk.encrypted-backup";
export const ENCRYPTED_BACKUP_FORMAT_VERSION = 1;
export const BACKUP_KDF_ITERATIONS = 600_000;
export const MIN_BACKUP_PASSPHRASE_CHARS = 12;
export const MAX_BACKUP_PASSPHRASE_CHARS = 128;
export const MAX_ENCRYPTED_BACKUP_BYTES = 132 * 1024 * 1024;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;
const GCM_TAG_BITS = 128;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function byteLength(value) {
  return textBytes(value).byteLength;
}

function requireCrypto() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("当前浏览器不支持本地加密迁移卷");
  }
  return globalThis.crypto;
}

function isoDate(value) {
  const candidate = String(value || "").trim().slice(0, 40);
  return Number.isFinite(new Date(candidate).getTime()) ? new Date(candidate).toISOString() : "";
}

function base64Bytes(value, expectedBytes = null) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new Error("加密卷包含无效的二进制字段");
  }
  let decoded;
  try {
    decoded = globalThis.atob(value);
  } catch {
    throw new Error("加密卷包含无效的二进制字段");
  }
  if (expectedBytes !== null && decoded.length !== expectedBytes) throw new Error("加密卷的随机参数长度无效");
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return globalThis.btoa(chunks.join(""));
}

function decodedBase64Length(value) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new Error("加密卷密文不是有效的 Base64");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function authenticatedHeader(value) {
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    formatVersion: ENCRYPTED_BACKUP_FORMAT_VERSION,
    createdAt: value.createdAt,
    innerFormat: BACKUP_FORMAT,
    innerFormatVersion: BACKUP_FORMAT_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: BACKUP_KDF_ITERATIONS,
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

function validateEnvelope(value) {
  if (!value || typeof value !== "object" || value.format !== ENCRYPTED_BACKUP_FORMAT) return null;
  if (value.formatVersion !== ENCRYPTED_BACKUP_FORMAT_VERSION) throw new Error("这份加密卷来自不受支持的格式版本");
  const createdAt = isoDate(value.createdAt);
  if (!createdAt || createdAt !== value.createdAt) throw new Error("加密卷缺少有效的封卷时间");
  if (value.innerFormat !== BACKUP_FORMAT || value.innerFormatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error("加密卷中的迁移格式不受支持");
  }
  if (value.kdf?.name !== "PBKDF2" || value.kdf?.hash !== "SHA-256" || value.kdf?.iterations !== BACKUP_KDF_ITERATIONS) {
    throw new Error("加密卷使用了不受支持的口令派生参数");
  }
  base64Bytes(value.kdf.salt, SALT_BYTES);
  if (value.cipher?.name !== "AES-GCM" || value.cipher?.keyLength !== AES_KEY_BITS || value.cipher?.tagLength !== GCM_TAG_BITS) {
    throw new Error("加密卷使用了不受支持的加密参数");
  }
  base64Bytes(value.cipher.iv, IV_BYTES);
  const encryptedBytes = decodedBase64Length(value.ciphertext);
  if (encryptedBytes < GCM_TAG_BITS / 8 || encryptedBytes > MAX_BACKUP_BYTES + GCM_TAG_BITS / 8) {
    throw new Error("加密卷的密文大小无效");
  }
  return {
    ...authenticatedHeader(value),
    ciphertext: value.ciphertext,
  };
}

async function deriveBackupKey(passphrase, salt) {
  const crypto = requireCrypto();
  const keyMaterial = await crypto.subtle.importKey("raw", textBytes(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: BACKUP_KDF_ITERATIONS,
    salt,
  }, keyMaterial, { name: "AES-GCM", length: AES_KEY_BITS }, false, ["encrypt", "decrypt"]);
}

export function validateBackupPassphrase(value) {
  const passphrase = typeof value === "string" ? value : "";
  const characters = Array.from(passphrase).length;
  if (characters < MIN_BACKUP_PASSPHRASE_CHARS) throw new Error("保护口令至少需要 12 个字符");
  if (characters > MAX_BACKUP_PASSPHRASE_CHARS || byteLength(passphrase) > 512) throw new Error("保护口令不能超过 128 个字符");
  if (/^[\s]+$/u.test(passphrase)) throw new Error("保护口令不能全部是空白字符");
  if (/[\u0000-\u001f\u007f]/u.test(passphrase)) throw new Error("保护口令不能包含控制字符");
  return passphrase;
}

export function inspectEncryptedBackupText(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (byteLength(raw) > MAX_ENCRYPTED_BACKUP_BYTES) throw new Error("加密迁移卷超过 132MB 上限");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateEnvelope(value);
}

export async function encryptBackupText(raw, passphraseValue) {
  if (typeof raw !== "string" || byteLength(raw) > MAX_BACKUP_BYTES) throw new Error("待加密迁移卷大小无效");
  const passphrase = validateBackupPassphrase(passphraseValue);
  const parsed = await parseBackupText(raw);
  const crypto = requireCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const header = authenticatedHeader({
    createdAt: parsed.envelope.exportedAt,
    kdf: { salt: bytesToBase64(salt) },
    cipher: { iv: bytesToBase64(iv) },
  });
  const key = await deriveBackupKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: textBytes(JSON.stringify(header)),
    tagLength: GCM_TAG_BITS,
  }, key, textBytes(raw));
  const envelope = { ...header, ciphertext: bytesToBase64(ciphertext) };
  if (byteLength(JSON.stringify(envelope)) > MAX_ENCRYPTED_BACKUP_BYTES) throw new Error("加密迁移卷超过 132MB 上限");
  return envelope;
}

export function serializeEncryptedBackupEnvelope(envelopeValue) {
  const envelope = validateEnvelope(envelopeValue);
  if (!envelope) throw new Error("这不是 Evolve Desk 加密迁移卷");
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  if (byteLength(serialized) > MAX_ENCRYPTED_BACKUP_BYTES) throw new Error("加密迁移卷超过 132MB 上限");
  return serialized;
}

export async function decryptBackupEnvelope(envelopeValue, passphraseValue) {
  const envelope = validateEnvelope(envelopeValue);
  if (!envelope) throw new Error("这不是 Evolve Desk 加密迁移卷");
  const passphrase = validateBackupPassphrase(passphraseValue);
  const salt = base64Bytes(envelope.kdf.salt, SALT_BYTES);
  const iv = base64Bytes(envelope.cipher.iv, IV_BYTES);
  const ciphertext = base64Bytes(envelope.ciphertext);
  const key = await deriveBackupKey(passphrase, salt);
  let plaintext;
  try {
    plaintext = await requireCrypto().subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: textBytes(JSON.stringify(authenticatedHeader(envelope))),
      tagLength: GCM_TAG_BITS,
    }, key, ciphertext);
  } catch {
    throw new Error("保护口令不正确，或加密迁移卷已被修改");
  }
  if (plaintext.byteLength > MAX_BACKUP_BYTES) throw new Error("解锁后的迁移卷超过 96MB 上限");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new Error("解锁后的迁移卷不是有效的 UTF-8 文本");
  }
}
