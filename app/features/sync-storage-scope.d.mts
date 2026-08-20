import type { SyncStorageRecipeId } from "./sync-storage-recipes.mjs";

export type SyncStorageScopeProvider = Exclude<SyncStorageRecipeId, "http-gateway">;
export type R2LocalCredentialClaims = {
  bucket: string;
  scope: "object-read-write";
  actions: ["GetObject", "PutObject"];
  paths: { prefixPaths: []; objectPaths: [string] };
};
export type AwsS3SessionPolicy = {
  Version: "2012-10-17";
  Statement: [{
    Sid: "EvolveDeskExactObject";
    Effect: "Allow";
    Action: ["s3:GetObject", "s3:PutObject"];
    Resource: string;
  }];
};
export type SyncStorageScopeTicket = {
  format: "evolve-desk-storage-scope-ticket";
  version: 1;
  provider: SyncStorageScopeProvider;
  target: { accountId?: string; bucket: string; objectKey: string; region: string };
  operations: ["GetObject", "PutObject"];
  ttlSeconds: number;
  providerPolicy: R2LocalCredentialClaims | AwsS3SessionPolicy;
};

export const SYNC_STORAGE_SCOPE_OPERATIONS: readonly ["GetObject", "PutObject"];
export const MIN_R2_SCOPE_TTL_SECONDS: number;
export const MIN_AWS_SCOPE_TTL_SECONDS: number;
export const MAX_SCOPE_TTL_SECONDS: number;
export const MAX_AWS_SCOPE_TTL_SECONDS: number;
export function createR2LocalCredentialClaims(value: { accountId: string; bucket: string; objectKey: string }): R2LocalCredentialClaims;
export function createAwsS3SessionPolicy(value: { bucket: string; objectKey: string; region: string }): AwsS3SessionPolicy;
export function createSyncStorageScopeTicket(provider: SyncStorageScopeProvider, value: { accountId?: string; bucket: string; objectKey: string; region: string; ttlSeconds: number }): SyncStorageScopeTicket;
export function inspectSyncStorageScopeTicket(value: unknown): SyncStorageScopeTicket;
export function serializeSyncStorageScopeTicket(value: unknown): string;
