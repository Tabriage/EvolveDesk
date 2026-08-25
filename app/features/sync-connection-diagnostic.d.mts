import type { AwsCredentialLifecycle } from "./aws-sigv4.mjs";
import type { SyncStorageRecipeId } from "./sync-storage-recipes.mjs";

export const SYNC_CONNECTION_DIAGNOSTIC_FORMAT: "evolve-desk-sync-connection-diagnostic";
export const SYNC_CONNECTION_DIAGNOSTIC_VERSION: 1;
export const MAX_SYNC_CONNECTION_DIAGNOSTIC_BYTES: number;

export type SyncConnectionDiagnostic = {
  body: {
    format: "evolve-desk-sync-connection-diagnostic";
    version: 1;
    createdAt: string;
    recipe: { id: SyncStorageRecipeId; authType: "bearer" | "aws-sigv4"; region: string };
    target: { endpointDigest: string; objectDigest: string };
    credential: { source: "none" | "manual" | "broker"; lifecycle: AwsCredentialLifecycle["status"]; expiresAt: string; hasSessionToken: boolean; accessKeyDigest: string };
    probe: { status: "not-checked" | "empty" | "etag-ready" | "read-only" | "error"; checkedAt: string; revisionDigest: string; validatorDigest: string; failureCode: "" | "access-denied" | "network-or-cors" | "invalid-object" | "conditional-conflict" | "unknown" };
    contract: { read: "GET"; write: "PUT"; firstWrite: "If-None-Match: *"; nextWrite: "If-Match: strong ETag"; responseEvidence: "Expose ETag" };
  };
  digest: string;
};

export function createSyncConnectionDiagnostic(value: {
  recipeId: SyncStorageRecipeId;
  objectUrl: string;
  region?: string;
  accessKeyId?: string;
  sessionToken?: string;
  expiresAt?: string | number;
  credentialSource?: "manual" | "broker";
  probe?: { status?: SyncConnectionDiagnostic["body"]["probe"]["status"]; checkedAt?: string; revisionId?: string; validator?: string; failureCode?: SyncConnectionDiagnostic["body"]["probe"]["failureCode"] };
}, now?: string | Date): Promise<SyncConnectionDiagnostic>;
export function serializeSyncConnectionDiagnostic(diagnostic: SyncConnectionDiagnostic): string;
export function inspectSyncConnectionDiagnosticText(raw: string): Promise<{ diagnostic: SyncConnectionDiagnostic; digest: string; sealed: true }>;
