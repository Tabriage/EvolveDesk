import assert from "node:assert/strict";
import test from "node:test";
import {
  createCloudflareDeploymentProofLogMarker,
  createCloudflareStorageBrokerDeploymentProof,
  inspectCloudflareDeploymentProofFromBuildLogText,
  inspectCloudflareStorageBrokerDeploymentProof,
  inspectCloudflareStorageBrokerDeploymentProofText,
  inspectCloudflareWranglerDeployOutputText,
  serializeCloudflareStorageBrokerDeploymentProof,
  verifyCloudflareStorageBrokerDeploymentRuntime,
} from "../app/features/storage-broker-cloudflare-deployment-proof.mjs";
import {
  STORAGE_BROKER_RELEASE_TARGETS,
  createStorageBrokerReleaseProof,
} from "../app/features/storage-broker-release-proof.mjs";
import { createCredentialBrokerRuntimeChallenge } from "../app/features/sync-credential-broker.mjs";

const commit = "a".repeat(40);
const versionId = "11111111-2222-4333-8444-555555555555";
const buildUuid = "12345678-1234-4234-8234-123456789abc";

async function releaseProof() {
  return createStorageBrokerReleaseProof({
    target: "cloudflare-worker-r2",
    createdAt: "2026-08-21T10:00:00.000Z",
    source: {
      repository: "https://github.com/Tabriage/EvolveDesk.git",
      commit,
      branch: "main",
      clean: true,
      remoteHeadVerified: true,
    },
    deployment: {
      endpointOrigin: "https://broker.example",
      allowedWorkbenchOrigin: "https://desk.example",
    },
    files: STORAGE_BROKER_RELEASE_TARGETS["cloudflare-worker-r2"].files.map((path, index) => ({
      path,
      sha256: String(index + 1).padStart(64, "0"),
    })),
  });
}

async function input() {
  return {
    createdAt: "2026-08-21T10:03:00.000Z",
    releaseProof: await releaseProof(),
    ci: {
      repository: "Tabriage/EvolveDesk",
      commit,
      branch: "main",
      buildUuid,
    },
    cloud: {
      scriptName: "evolve-desk-r2-credential-broker",
      workerTag: "abc123def456",
      versionId,
      versionTag: `evolve-${commit}`,
      endpointOrigin: "https://broker.example",
      deployedAt: "2026-08-21T10:02:00.000Z",
    },
  };
}

test("Wrangler NDJSON parser closes the deployed Worker name and Version ID", () => {
  const output = [
    JSON.stringify({ type: "wrangler-session", version: 1, timestamp: "2026-08-21T10:01:00.000Z" }),
    JSON.stringify({
      type: "deploy",
      version: 1,
      worker_name: "evolve-desk-r2-credential-broker",
      worker_tag: "abc123def456",
      version_id: versionId,
      targets: ["https://broker.example"],
      worker_name_overridden: false,
      timestamp: "2026-08-21T10:02:00.000Z",
    }),
  ].join("\n");
  const parsed = inspectCloudflareWranglerDeployOutputText(output);
  assert.equal(parsed.versionId, versionId);
  assert.equal(parsed.workerName, "evolve-desk-r2-credential-broker");
  assert.throws(() => inspectCloudflareWranglerDeployOutputText(`${output}\n${output}`), /只能包含一个 deploy/);
  assert.throws(() => inspectCloudflareWranglerDeployOutputText(output.replace("false", "true")), /覆盖了 Worker 名称/);
  assert.throws(() => inspectCloudflareWranglerDeployOutputText("not-json"), /NDJSON/);
});

test("Cloudflare deployment proof survives build-log transport without becoming a signed attestation", async () => {
  const proof = await createCloudflareStorageBrokerDeploymentProof(await input());
  assert.equal(proof.body.ci.system, "cloudflare-workers-builds");
  assert.equal(proof.body.ci.credentialMode, "cloudflare-user-api-token");
  assert.equal(proof.body.cloud.versionId, versionId);
  assert.deepEqual(await inspectCloudflareStorageBrokerDeploymentProof(proof), proof);
  assert.deepEqual(await inspectCloudflareStorageBrokerDeploymentProofText(await serializeCloudflareStorageBrokerDeploymentProof(proof)), proof);
  const marker = await createCloudflareDeploymentProofLogMarker(proof);
  assert.deepEqual(await inspectCloudflareDeploymentProofFromBuildLogText(`build start\n${marker}\nbuild end\n`), proof);
  await assert.rejects(inspectCloudflareDeploymentProofFromBuildLogText(`${marker}\n${marker}`), /只能包含一个/);
});

test("Cloudflare deployment proof rejects source, build, endpoint, version, time, and hidden mutations", async () => {
  const value = await input();
  const proof = await createCloudflareStorageBrokerDeploymentProof(value);
  await assert.rejects(createCloudflareStorageBrokerDeploymentProof({ ...value, ci: { ...value.ci, commit: "b".repeat(40) } }), /提交与发布封签/);
  await assert.rejects(createCloudflareStorageBrokerDeploymentProof({ ...value, ci: { ...value.ci, branch: "other" } }), /分支与发布封签/);
  await assert.rejects(createCloudflareStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, versionTag: `evolve-${"b".repeat(40)}` } }), /标签与提交/);
  await assert.rejects(createCloudflareStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, endpointOrigin: "https://other.example" } }), /端点与发布封签/);
  await assert.rejects(createCloudflareStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, versionId: "latest" } }), /Version ID/);
  await assert.rejects(createCloudflareStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, deployedAt: "2026-08-21T09:59:00.000Z" } }), /时间顺序/);
  await assert.rejects(inspectCloudflareStorageBrokerDeploymentProof({ ...proof, hidden: true }), /字段、版本|SHA-256/);
  await assert.rejects(inspectCloudflareStorageBrokerDeploymentProof({ ...proof, digest: { ...proof.digest, value: "f".repeat(64) } }), /SHA-256/);
  await assert.rejects(inspectCloudflareStorageBrokerDeploymentProofText("x".repeat(256 * 1024 + 1)), /256 KiB/);
});

test("fresh runtime challenge binds the current Worker Version ID to the imported proof", async () => {
  const proof = await createCloudflareStorageBrokerDeploymentProof(await input());
  const challengeValue = "0123456789abcdef".repeat(4);
  const release = {
    ci: {
      system: "cloudflare-workers-builds",
      repository: "Tabriage/EvolveDesk",
      commit,
      branch: "main",
      buildUuid,
    },
    runtime: {
      provider: "cloudflare-workers",
      scriptName: "evolve-desk-r2-credential-broker",
      versionId,
      versionTag: `evolve-${commit}`,
      versionCreatedAt: "2026-08-21T10:01:30.000Z",
    },
  };
  const health = {
    ok: true,
    service: "evolve-desk-storage-broker",
    providers: { cloudflareR2: true, amazonS3: false },
    release,
    challenge: await createCredentialBrokerRuntimeChallenge(challengeValue, release),
  };
  const result = await verifyCloudflareStorageBrokerDeploymentRuntime(proof, health, {
    challenge: challengeValue,
    now: "2026-08-21T10:04:00.000Z",
  });
  assert.equal(result.system, "cloudflare-worker-runtime-challenge");
  assert.equal(result.versionId, versionId);
  assert.equal(result.commit, commit);
  assert.match(result.challengeDigest, /^[0-9a-f]{64}$/);
  await assert.rejects(verifyCloudflareStorageBrokerDeploymentRuntime(proof, {
    ...health,
    release: { ...release, runtime: { ...release.runtime, versionId: "99999999-2222-4333-8444-555555555555" } },
  }, { challenge: challengeValue }), /Version ID|versionId|挑战响应/);
  await assert.rejects(verifyCloudflareStorageBrokerDeploymentRuntime(proof, {
    ...health,
    challenge: { ...health.challenge, value: "f".repeat(64) },
  }, { challenge: challengeValue }), /挑战响应不匹配/);
});
