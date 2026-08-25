import assert from "node:assert/strict";
import test from "node:test";
import {
  STORAGE_BROKER_RELEASE_TARGETS,
  createStorageBrokerReleaseProof,
  inspectStorageBrokerReleaseProof,
  inspectStorageBrokerReleaseProofText,
  serializeStorageBrokerReleaseProof,
} from "../app/features/storage-broker-release-proof.mjs";

function input(target = "cloudflare-worker-r2") {
  return {
    target,
    createdAt: "2026-08-21T10:00:00.000Z",
    source: {
      repository: "https://github.com/Tabriage/EvolveDesk.git",
      commit: "a".repeat(40),
      branch: "agent/source-evolution-lab",
      clean: true,
      remoteHeadVerified: true,
    },
    deployment: {
      endpointOrigin: target === "aws-lambda-s3" ? "https://example.lambda-url.us-east-1.on.aws" : "https://broker.example",
      allowedWorkbenchOrigin: "https://desk.example",
    },
    files: STORAGE_BROKER_RELEASE_TARGETS[target].files.map((path, index) => ({ path, sha256: String(index + 1).padStart(64, "0") })),
  };
}

test("release proof seals exact runtime files, source commit, endpoint, and public security contract", async () => {
  const proof = await createStorageBrokerReleaseProof(input());
  assert.equal(proof.body.source.clean, true);
  assert.equal(proof.body.source.remoteHeadVerified, true);
  assert.equal(proof.body.capabilities.exactObjectScope, true);
  assert.equal(proof.body.capabilities.bearerRequired, true);
  assert.equal(proof.body.capabilities.publicEndpoint, true);
  assert.deepEqual(proof.body.capabilities.operations, ["GetObject", "PutObject"]);
  assert.deepEqual(await inspectStorageBrokerReleaseProof(proof), proof);
  assert.deepEqual(await inspectStorageBrokerReleaseProofText(await serializeStorageBrokerReleaseProof(proof)), proof);
  assert.equal(JSON.stringify(proof).includes("secretAccessKey"), false);
});

test("release proof rejects source, file, endpoint, capability, and seal mutations", async () => {
  const proof = await createStorageBrokerReleaseProof(input("aws-lambda-s3"));
  await assert.rejects(createStorageBrokerReleaseProof({ ...input(), source: { ...input().source, clean: false } }), /干净 Git/);
  await assert.rejects(createStorageBrokerReleaseProof({ ...input(), source: { ...input().source, remoteHeadVerified: false } }), /远端分支头/);
  await assert.rejects(createStorageBrokerReleaseProof({ ...input(), files: input().files.slice(1) }), /文件集合/);
  await assert.rejects(createStorageBrokerReleaseProof({ ...input("aws-lambda-s3"), deployment: { ...input("aws-lambda-s3").deployment, endpointOrigin: "https://api.example" } }), /Function URL/);
  await assert.rejects(inspectStorageBrokerReleaseProof({ ...proof, body: { ...proof.body, capabilities: { ...proof.body.capabilities, bearerRequired: false } } }), /字段、来源|SHA-256/);
  await assert.rejects(inspectStorageBrokerReleaseProof({ ...proof, extra: true }), /字段、来源|SHA-256/);
  await assert.rejects(inspectStorageBrokerReleaseProof({ ...proof, digest: { ...proof.digest, value: "f".repeat(64) } }), /SHA-256/);
});

test("release proof text parser stays bounded", async () => {
  await assert.rejects(inspectStorageBrokerReleaseProofText("x".repeat(128 * 1024 + 1)), /128 KiB/);
  await assert.rejects(inspectStorageBrokerReleaseProofText("not-json"), /有效 JSON/);
});
