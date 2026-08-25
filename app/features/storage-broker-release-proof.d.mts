export type StorageBrokerReleaseTarget = "cloudflare-worker-r2" | "aws-lambda-s3";
export type StorageBrokerReleaseProof = {
  format: "evolve-desk-storage-broker-release-proof";
  version: 1;
  body: {
    target: StorageBrokerReleaseTarget;
    createdAt: string;
    source: { repository: string; commit: string; branch: string; clean: true; remoteHeadVerified: true };
    deployment: { endpointOrigin: string; credentialPath: "/credentials"; healthPath: "/health"; allowedWorkbenchOrigin: string };
    capabilities: {
      provider: "cloudflare-r2" | "amazon-s3";
      runtime: string;
      issuer: string;
      operations: ["GetObject", "PutObject"];
      ttlRangeSeconds: [number, number];
      exactObjectScope: true;
      bearerRequired: true;
      httpsRequired: true;
      publicEndpoint: true;
      maxRequestBytes: 65536;
      requiredSecretNames: string[];
    };
    files: Array<{ path: string; sha256: string }>;
  };
  digest: { algorithm: "SHA-256"; value: string };
};

export const MAX_STORAGE_BROKER_RELEASE_PROOF_BYTES: number;
export const STORAGE_BROKER_RELEASE_TARGETS: Readonly<Record<StorageBrokerReleaseTarget, {
  provider: "cloudflare-r2" | "amazon-s3";
  runtime: string;
  issuer: string;
  ttlRangeSeconds: readonly [number, number];
  requiredSecretNames: readonly string[];
  files: readonly string[];
}>>;
export function createStorageBrokerReleaseProof(value: unknown): Promise<StorageBrokerReleaseProof>;
export function inspectStorageBrokerReleaseProof(value: unknown): Promise<StorageBrokerReleaseProof>;
export function inspectStorageBrokerReleaseProofText(raw: string): Promise<StorageBrokerReleaseProof>;
export function serializeStorageBrokerReleaseProof(value: unknown): Promise<string>;
