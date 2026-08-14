import type { SyncTransportAdapter } from "./sync-core.mjs";

export const REMOTE_TRANSPORT_ID: "http-conditional-object";
export const MAX_REMOTE_TOKEN_CHARS: number;

export type RemoteTransportConfig = { objectUrl: string; bearerToken?: string };

export function normalizeRemoteTransportConfig(value: RemoteTransportConfig): { objectUrl: string; bearerToken: string };
export function createHttpSyncTransport(config: RemoteTransportConfig, fetchImpl?: typeof fetch): SyncTransportAdapter & { objectUrl: string };
