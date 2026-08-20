import type { DeviceProof, SyncChannel, SyncIdentity, SyncPublicDevice, SyncRecoveryKit } from "./sync-core.mjs";

export const RECOVERY_MAINTENANCE_RECORD_VERSION: 1;
export const RECOVERY_DRILL_INTERVAL_DAYS: 90;
export const RECOVERY_REPLACEMENT_REVIEW_DAYS: 180;
export const MAX_RECOVERY_MAINTENANCE_AUDIT_BYTES: number;

export type SyncRecoverySecurityProfile = { hash: string; authorizedDeviceCount: number; revokedDeviceCount: number };
export type SyncRecoveryDrillReceipt = {
  recoveryId: string;
  channelId: string;
  generation: number;
  drilledAt: string;
  packetRevisionId: string;
  packetCreatedAt: string;
  packetAuthorFingerprint: string;
  workspaceVersion: number;
  securityProfileHash: string;
  authorizedDeviceCount: number;
  revokedDeviceCount: number;
};
export type SyncRecoveryMaintenanceRecord = {
  recordVersion: 1;
  channelId: string;
  generation: number;
  recoveryId: string;
  ownerFingerprint: string;
  kitCreatedAt: string;
  kitBoundRevisionId: string;
  securityProfileHash: string;
  authorizedDeviceCount: number;
  revokedDeviceCount: number;
  trackedAt: string;
  previousRecoveryId: string;
  separateStorageConfirmedAt: string;
  oldCopiesRetiredAt: string;
  lastDrill: Omit<SyncRecoveryDrillReceipt, "recoveryId" | "channelId" | "generation" | "authorizedDeviceCount" | "revokedDeviceCount"> | null;
};
export type SyncRecoveryMaintenanceAssessment = {
  status: "missing" | "replace" | "drill-due" | "packet-refresh" | "storage-action" | "ready";
  headline: string;
  detail: string;
  reasons: string[];
  nextDrillAt: string;
  replacementReviewAt: string;
  kitAgeDays: number;
  drillAgeDays: number | null;
  checklist: Array<{ id: "kit" | "packet" | "drill" | "separate-storage" | "retire-old-copies"; label: string; done: boolean; action: string }>;
};
export type SyncRecoveryMaintenanceAuditReceipt = {
  format: "evolve-desk.recovery-maintenance-audit";
  formatVersion: 1;
  receiptId: string;
  createdAt: string;
  record: SyncRecoveryMaintenanceRecord;
  integrity: { algorithm: "SHA-256"; digest: string };
};
export type SignedSyncRecoveryMaintenanceAuditReceipt = Omit<SyncRecoveryMaintenanceAuditReceipt, "formatVersion"> & {
  formatVersion: 2;
  signer: SyncPublicDevice;
  proof: DeviceProof;
};
export type AnySyncRecoveryMaintenanceAuditReceipt = SyncRecoveryMaintenanceAuditReceipt | SignedSyncRecoveryMaintenanceAuditReceipt;
export type SyncRecoveryMaintenanceAuditInspection = {
  receipt: AnySyncRecoveryMaintenanceAuditReceipt;
  sealed: true;
  signed: boolean;
  signatureValid: boolean;
  signer: SyncPublicDevice | null;
  digest: string;
  nextDrillAt: string;
  replacementReviewAt: string;
  hasDrill: boolean;
  separateStorageConfirmed: boolean;
  oldCopiesRetired: boolean;
};
export type SyncRecoveryMaintenanceAuditTrustAssessment = {
  signed: boolean;
  signatureValid: boolean;
  trusted: boolean;
  channelKnown: boolean;
  channelLabel: string;
  channelRetired: boolean;
  generationMatches: boolean;
  ownerMatches: boolean;
  signer: SyncPublicDevice | null;
  reason: string;
};

export function normalizeSyncRecoveryMaintenanceRecord(value: unknown): SyncRecoveryMaintenanceRecord;
export function createSyncRecoverySecurityProfile(value: Pick<SyncChannel, "authorizedDevices" | "revokedDeviceIds">): Promise<SyncRecoverySecurityProfile>;
export function createSyncRecoveryMaintenanceRecord(channel: SyncChannel, recovery: SyncRecoveryKit, profile: SyncRecoverySecurityProfile, trackedAt?: string, previous?: SyncRecoveryMaintenanceRecord | null): SyncRecoveryMaintenanceRecord;
export function shouldTrackSyncRecoveryKit(record: SyncRecoveryMaintenanceRecord | null, recovery: SyncRecoveryKit): boolean;
export function recordSyncRecoveryDrill(record: SyncRecoveryMaintenanceRecord, drill: SyncRecoveryDrillReceipt): SyncRecoveryMaintenanceRecord;
export function setSyncRecoveryMaintenanceConfirmation(record: SyncRecoveryMaintenanceRecord, confirmationId: "separate-storage" | "retire-old-copies", confirmed: boolean, confirmedAt?: string): SyncRecoveryMaintenanceRecord;
export function assessSyncRecoveryMaintenance(channel: SyncChannel, record: SyncRecoveryMaintenanceRecord | null, now?: string): Promise<SyncRecoveryMaintenanceAssessment>;
export function createSyncRecoveryMaintenanceAudit(record: SyncRecoveryMaintenanceRecord, createdAt?: string): Promise<SyncRecoveryMaintenanceAuditReceipt>;
export function createSignedSyncRecoveryMaintenanceAudit(record: SyncRecoveryMaintenanceRecord, identity: SyncIdentity, createdAt?: string): Promise<SignedSyncRecoveryMaintenanceAuditReceipt>;
export function serializeSyncRecoveryMaintenanceAudit(receipt: AnySyncRecoveryMaintenanceAuditReceipt): string;
export function inspectSyncRecoveryMaintenanceAuditText(raw: string): Promise<SyncRecoveryMaintenanceAuditInspection>;
export function assessSyncRecoveryMaintenanceAuditTrust(receipt: AnySyncRecoveryMaintenanceAuditReceipt, channels?: SyncChannel[]): Promise<SyncRecoveryMaintenanceAuditTrustAssessment>;
export function compareSyncRecoveryMaintenanceAuditToRecord(receipt: AnySyncRecoveryMaintenanceAuditReceipt, record: SyncRecoveryMaintenanceRecord): { matches: boolean; reasons: string[] };
