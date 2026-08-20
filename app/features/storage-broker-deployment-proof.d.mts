import type { StorageBrokerReleaseProof } from "./storage-broker-release-proof.mjs";

export type StorageBrokerDeploymentProof = {
  format: "evolve-desk-storage-broker-deployment-proof";
  version: 1;
  body: {
    createdAt: string;
    releaseProof: StorageBrokerReleaseProof;
    ci: {
      system: "github-actions";
      repository: string;
      commit: string;
      ref: string;
      workflowPath: string;
      runId: string;
      runAttempt: number;
      runUrl: string;
      environment: string;
      credentialMode: "github-oidc";
      artifactAttestation: { kind: "github-artifact-attestation"; verificationRequired: true };
    };
    cloud: {
      provider: "aws-lambda";
      region: string;
      resourceArn: string;
      immutableVersion: string;
      endpointOrigin: string;
      codeDigest: { algorithm: "SHA-256"; encoding: "base64"; value: string };
      observedAt: string;
    };
  };
  digest: { algorithm: "SHA-256"; value: string };
};

export const MAX_STORAGE_BROKER_DEPLOYMENT_PROOF_BYTES: number;
export function createStorageBrokerDeploymentProof(value: unknown): Promise<StorageBrokerDeploymentProof>;
export function inspectStorageBrokerDeploymentProof(value: unknown): Promise<StorageBrokerDeploymentProof>;
export function inspectStorageBrokerDeploymentProofText(raw: string): Promise<StorageBrokerDeploymentProof>;
export function serializeStorageBrokerDeploymentProof(value: unknown): Promise<string>;
