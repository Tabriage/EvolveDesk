import type { SyncStorageRecipeId } from "./sync-storage-recipes.mjs";

export const MAX_CREDENTIAL_BROKER_RESPONSE_BYTES: number;
export const MIN_CREDENTIAL_TTL_SECONDS: number;
export const MAX_CREDENTIAL_TTL_SECONDS: number;

export type CredentialBrokerScope = {
  provider: Exclude<SyncStorageRecipeId, "http-gateway">;
  accountId?: string;
  bucket: string;
  objectKey: string;
  region: string;
  ttlSeconds: number;
};

export type CredentialBrokerRequest = {
  format: "evolve-desk-storage-credential-request";
  version: 1;
  provider: Exclude<SyncStorageRecipeId, "http-gateway">;
  scope: {
    accountId?: string;
    bucket: string;
    objectKey: string;
    region: string;
    operations: ["GetObject", "PutObject"];
  };
  ttlSeconds: number;
};

export function createCredentialBrokerRequest(scope: CredentialBrokerScope): CredentialBrokerRequest;
export function inspectCredentialBrokerRequest(value: unknown): CredentialBrokerRequest;
export function normalizeCredentialBrokerResponse(parsed: unknown, request: CredentialBrokerRequest, now?: string | Date): { accessKeyId: string; secretAccessKey: string; sessionToken: string; region: string; expiresAt: string };
export function renewSyncStorageCredentials(
  config: { endpointUrl: string; bearerToken?: string },
  scope: CredentialBrokerScope,
  fetchImpl?: typeof fetch,
  nowImpl?: () => Date,
): Promise<{ credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string; region: string; expiresAt: string }; requestedAt: string; ttlSeconds: number }>;
export type CredentialBrokerHealth = {
  ok: true;
  service: "evolve-desk-storage-broker";
  providers: { cloudflareR2: boolean; amazonS3: boolean };
  release?: {
    ci: {
      system: "github-actions";
      repository: string;
      commit: string;
      ref: string;
      workflowPath: string;
      runId: string;
      runAttempt: number;
    };
    runtime: {
      provider: "aws-lambda";
      region: string;
      functionName: string;
      immutableVersion: string;
    };
  } | {
    ci: {
      system: "cloudflare-workers-builds";
      repository: string;
      commit: string;
      branch: string;
      buildUuid: string;
    };
    runtime: {
      provider: "cloudflare-workers";
      scriptName: string;
      versionId: string;
      versionTag: string;
      versionCreatedAt: string;
    };
  };
  challenge?: {
    algorithm: "SHA-256";
    value: string;
    digest: string;
  };
};
export function inspectCredentialBrokerRuntimeRelease(value: unknown): CredentialBrokerHealth["release"];
export function createCredentialBrokerRuntimeChallenge(value: string, release: unknown): Promise<NonNullable<CredentialBrokerHealth["challenge"]>>;
export function inspectCredentialBrokerRuntimeChallenge(value: unknown, release: unknown, expectedValue: string): Promise<NonNullable<CredentialBrokerHealth["challenge"]>>;
export function inspectCredentialBrokerHealth(
  config: { endpointUrl: string; bearerToken?: string },
  fetchImpl?: typeof fetch,
  options?: { challenge?: string },
): Promise<CredentialBrokerHealth>;
