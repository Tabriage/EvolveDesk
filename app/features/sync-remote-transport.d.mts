import type { SyncTransportAdapter } from "./sync-core.mjs";
import type { AwsSigV4Credentials } from "./aws-sigv4.mjs";

export const REMOTE_TRANSPORT_ID: "http-conditional-object";
export const MAX_REMOTE_TOKEN_CHARS: number;

export type RemoteTransportConfig = { objectUrl: string; bearerToken?: string; sigv4?: AwsSigV4Credentials };

export function normalizeRemoteTransportConfig(value: RemoteTransportConfig): { objectUrl: string; bearerToken: string; sigv4: Required<AwsSigV4Credentials> | null };
export function createHttpSyncTransport(config: RemoteTransportConfig, fetchImpl?: typeof fetch, nowImpl?: () => Date): SyncTransportAdapter & { objectUrl: string; authType: "bearer" | "aws-sigv4" };
