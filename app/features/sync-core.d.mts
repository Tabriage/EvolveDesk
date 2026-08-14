import type { BackupEnvelope, BackupSources, BackupSummary } from "./backup-core.mjs";
import type { WorkbenchState } from "./workbench-core.mjs";

export const SYNC_PAIRING_FORMAT: "evolve-desk.sync-pairing";
export const SYNC_GRANT_FORMAT: "evolve-desk.sync-grant";
export const SYNC_PACKET_FORMAT: "evolve-desk.sync-packet";
export const SYNC_FORMAT_VERSION: 1;
export const MAX_SYNC_CONTROL_BYTES: number;
export const MAX_SYNC_PACKET_BYTES: number;
export const PAIRING_LIFETIME_MS: number;

export type SyncPublicDevice = {
  deviceId: string;
  name: string;
  createdAt: string;
  exchangePublicKey: JsonWebKey;
  signingPublicKey: JsonWebKey;
  fingerprint: string;
};

export type SyncIdentity = { device: SyncPublicDevice; exchangePrivateKey: CryptoKey; signingPrivateKey: CryptoKey };
export type DeviceProof = { name: "ECDSA"; hash: "SHA-256"; signature: string };
export type AuthorizedSyncDevice = SyncPublicDevice & { authorizedAt: string; authorizedBy: string };
export type SyncChannel = {
  channelId: string;
  label: string;
  createdAt: string;
  ownerDeviceId: string;
  role: "owner" | "member";
  key: CryptoKey;
  authorizedDevices: AuthorizedSyncDevice[];
  headRevisionId: string;
  lastPacketAt: string;
};

export type PairingRequest = {
  format: typeof SYNC_PAIRING_FORMAT;
  formatVersion: 1;
  requestId: string;
  createdAt: string;
  expiresAt: string;
  device: SyncPublicDevice;
  proof: DeviceProof;
};

export type DeviceGrant = {
  format: typeof SYNC_GRANT_FORMAT;
  formatVersion: 1;
  grantId: string;
  requestId: string;
  issuedAt: string;
  expiresAt: string;
  channel: { channelId: string; label: string; createdAt: string };
  grantor: SyncPublicDevice;
  recipient: SyncPublicDevice;
  keyAgreement: { name: "ECDH"; namedCurve: "P-256"; kdf: "HKDF-SHA-256"; salt: string };
  cipher: { name: "AES-GCM"; keyLength: 256; iv: string; tagLength: 128 };
  ciphertext: string;
  proof: DeviceProof;
};

export type SyncPacket = {
  format: typeof SYNC_PACKET_FORMAT;
  formatVersion: 1;
  channelId: string;
  revisionId: string;
  parentRevisionId: string;
  createdAt: string;
  author: { deviceId: string; fingerprint: string };
  innerFormat: "evolve-desk.backup";
  innerFormatVersion: 1;
  cipher: { name: "AES-GCM"; keyLength: 256; iv: string; tagLength: 128 };
  ciphertext: string;
  proof: DeviceProof;
};

export type SyncRevisionRelation = "initial" | "duplicate" | "forward" | "diverged";
export type SyncTransportAdapter = {
  id: string;
  label: string;
  read(channelId: string): Promise<string | null>;
  write(channelId: string, expectedRevisionId: string, packetText: string): Promise<{ written: boolean; currentRevisionId: string }>;
};

export function formatDeviceFingerprint(value: string): string;
export function createSyncIdentity(name?: string, createdAt?: string): Promise<SyncIdentity>;
export function createPairingRequest(identity: SyncIdentity, createdAt?: string): Promise<PairingRequest>;
export function serializePairingRequest(value: PairingRequest): string;
export function inspectPairingRequestText(raw: string, now?: Date): Promise<PairingRequest>;
export function createSyncChannel(identity: SyncIdentity, label?: string, createdAt?: string): Promise<SyncChannel>;
export function createDeviceGrant(channel: SyncChannel, identity: SyncIdentity, pairing: PairingRequest, issuedAt?: string): Promise<{ grant: DeviceGrant; channel: SyncChannel }>;
export function serializeDeviceGrant(value: DeviceGrant): string;
export function inspectDeviceGrantText(raw: string, now?: Date): Promise<DeviceGrant>;
export function acceptDeviceGrant(grant: DeviceGrant, identity: SyncIdentity, acceptedAt?: string): Promise<SyncChannel>;
export function classifySyncRevision(headRevisionId: string, packet: SyncPacket): SyncRevisionRelation;
export function createSyncPacket(backupText: string, channel: SyncChannel, identity: SyncIdentity, createdAt?: string): Promise<SyncPacket>;
export function serializeSyncPacket(value: SyncPacket): string;
export function inspectSyncPacketText(raw: string): SyncPacket;
export function decryptSyncPacket(packet: SyncPacket, channel: SyncChannel): Promise<{
  packet: SyncPacket;
  author: AuthorizedSyncDevice;
  backupText: string;
  parsed: { envelope: BackupEnvelope; workspace: WorkbenchState; sources: BackupSources; summary: BackupSummary };
  relation: SyncRevisionRelation;
}>;
