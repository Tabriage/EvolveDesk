import type { CredentialBrokerHealth } from "./sync-credential-broker.mjs";
import type { StorageBrokerReleaseProof } from "./storage-broker-release-proof.mjs";

export type CloudflareStorageBrokerDeploymentProof = {
  format: "evolve-desk-cloudflare-storage-broker-deployment-proof";
  version: 1;
  body: {
    createdAt: string;
    releaseProof: StorageBrokerReleaseProof;
    ci: {
      system: "cloudflare-workers-builds";
      repository: string;
      commit: string;
      branch: string;
      buildUuid: string;
      credentialMode: "cloudflare-user-api-token";
    };
    cloud: {
      provider: "cloudflare-workers";
      scriptName: string;
      workerTag: string;
      versionId: string;
      versionTag: string;
      endpointOrigin: string;
      deployedAt: string;
    };
  };
  digest: { algorithm: "SHA-256"; value: string };
};

export type CloudflareWranglerDeployOutput = {
  workerName: string;
  workerTag: string;
  versionId: string;
  deployedAt: string;
  targets: string[];
};

export type CloudflareStorageBrokerRuntimeVerification = {
  system: "cloudflare-worker-runtime-challenge";
  checkedAt: string;
  repository: string;
  commit: string;
  branch: string;
  buildUuid: string;
  scriptName: string;
  versionId: string;
  versionTag: string;
  versionCreatedAt: string;
  challengeDigest: string;
};

export const MAX_CLOUDFLARE_DEPLOYMENT_PROOF_BYTES: number;
export const MAX_WRANGLER_DEPLOY_OUTPUT_BYTES: number;
export const MAX_CLOUDFLARE_BUILD_LOG_BYTES: number;
export const CLOUDFLARE_DEPLOYMENT_PROOF_LOG_MARKER: string;
export function inspectCloudflareWranglerDeployOutputText(raw: string): CloudflareWranglerDeployOutput;
export function createCloudflareStorageBrokerDeploymentProof(value: unknown): Promise<CloudflareStorageBrokerDeploymentProof>;
export function inspectCloudflareStorageBrokerDeploymentProof(value: unknown): Promise<CloudflareStorageBrokerDeploymentProof>;
export function inspectCloudflareStorageBrokerDeploymentProofText(raw: string): Promise<CloudflareStorageBrokerDeploymentProof>;
export function serializeCloudflareStorageBrokerDeploymentProof(value: unknown): Promise<string>;
export function createCloudflareDeploymentProofLogMarker(value: unknown): Promise<string>;
export function inspectCloudflareDeploymentProofFromBuildLogText(raw: string): Promise<CloudflareStorageBrokerDeploymentProof>;
export function verifyCloudflareStorageBrokerDeploymentRuntime(
  value: unknown,
  health: CredentialBrokerHealth,
  options: { challenge: string; now?: Date | number | string },
): Promise<CloudflareStorageBrokerRuntimeVerification>;
