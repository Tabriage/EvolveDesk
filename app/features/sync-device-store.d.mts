import type { SyncChannel, SyncIdentity } from "./sync-core.mjs";

export const SYNC_CHANNELS_CHANGED_EVENT: "evolve-desk-sync-channels-changed";
export function loadOrCreateSyncIdentity(name?: string): Promise<SyncIdentity | null>;
export function renameSyncIdentity(identity: SyncIdentity, name: string): Promise<SyncIdentity>;
export function listSyncChannels(): Promise<SyncChannel[]>;
export function saveSyncChannel(channel: SyncChannel): Promise<SyncChannel>;
export function setSyncChannelHead(channelId: string, revisionId: string, lastPacketAt?: string): Promise<SyncChannel | null>;
