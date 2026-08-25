import type { SyncChannel, SyncIdentity } from "./sync-core.mjs";
import type { SyncRecoveryMaintenanceRecord } from "./recovery-maintenance.mjs";

export const SYNC_CHANNELS_CHANGED_EVENT: "evolve-desk-sync-channels-changed";
export const SYNC_RECOVERY_MAINTENANCE_CHANGED_EVENT: "evolve-desk-sync-recovery-maintenance-changed";
export function loadOrCreateSyncIdentity(name?: string): Promise<SyncIdentity | null>;
export function renameSyncIdentity(identity: SyncIdentity, name: string): Promise<SyncIdentity>;
export function listSyncChannels(): Promise<SyncChannel[]>;
export function saveSyncChannel(channel: SyncChannel): Promise<SyncChannel>;
export function saveRotatedSyncChannels(retiredChannel: SyncChannel, nextChannel: SyncChannel): Promise<{ retiredChannel: SyncChannel; nextChannel: SyncChannel }>;
export function setSyncChannelHead(channelId: string, revisionId: string, lastPacketAt?: string, mergeParentRevisionIds?: string[]): Promise<SyncChannel | null>;
export function saveSyncRevisionPacket(raw: string): Promise<boolean>;
export function getSyncRevisionPacket(channelId: string, revisionId: string): Promise<string | null>;
export function loadSyncRecoveryMaintenance(channelId: string): Promise<SyncRecoveryMaintenanceRecord | null>;
export function saveSyncRecoveryMaintenance(record: SyncRecoveryMaintenanceRecord): Promise<SyncRecoveryMaintenanceRecord>;
