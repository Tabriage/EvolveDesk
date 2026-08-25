export const ENCRYPTED_BACKUP_FORMAT: "evolve-desk.encrypted-backup";
export const ENCRYPTED_BACKUP_FORMAT_VERSION: 1;
export const BACKUP_KDF_ITERATIONS: 600000;
export const MIN_BACKUP_PASSPHRASE_CHARS: 12;
export const MAX_BACKUP_PASSPHRASE_CHARS: 128;
export const MAX_ENCRYPTED_BACKUP_BYTES: number;

export type EncryptedBackupEnvelope = {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  formatVersion: typeof ENCRYPTED_BACKUP_FORMAT_VERSION;
  createdAt: string;
  innerFormat: "evolve-desk.backup";
  innerFormatVersion: 1;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: typeof BACKUP_KDF_ITERATIONS;
    salt: string;
  };
  cipher: {
    name: "AES-GCM";
    keyLength: 256;
    iv: string;
    tagLength: 128;
  };
  ciphertext: string;
};

export function validateBackupPassphrase(value: unknown): string;
export function inspectEncryptedBackupText(raw: string): EncryptedBackupEnvelope | null;
export function encryptBackupText(raw: string, passphrase: string): Promise<EncryptedBackupEnvelope>;
export function serializeEncryptedBackupEnvelope(envelope: EncryptedBackupEnvelope): string;
export function decryptBackupEnvelope(envelope: EncryptedBackupEnvelope, passphrase: string): Promise<string>;
