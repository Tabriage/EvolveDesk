import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createStorageBrokerDeploymentProof,
  inspectStorageBrokerDeploymentProof,
  inspectStorageBrokerDeploymentProofText,
  serializeStorageBrokerDeploymentProof,
  verifyStorageBrokerDeploymentRun,
} from "../app/features/storage-broker-deployment-proof.mjs";
import {
  STORAGE_BROKER_RELEASE_TARGETS,
  createStorageBrokerReleaseProof,
} from "../app/features/storage-broker-release-proof.mjs";

async function releaseProof() {
  return createStorageBrokerReleaseProof({
    target: "aws-lambda-s3",
    createdAt: "2026-08-21T10:00:00.000Z",
    source: {
      repository: "https://github.com/Tabriage/EvolveDesk.git",
      commit: "a".repeat(40),
      branch: "main",
      clean: true,
      remoteHeadVerified: true,
    },
    deployment: {
      endpointOrigin: "https://example.lambda-url.us-east-1.on.aws",
      allowedWorkbenchOrigin: "https://desk.example",
    },
    files: STORAGE_BROKER_RELEASE_TARGETS["aws-lambda-s3"].files.map((path, index) => ({ path, sha256: String(index + 1).padStart(64, "0") })),
  });
}

async function input() {
  return {
    createdAt: "2026-08-21T10:05:00.000Z",
    releaseProof: await releaseProof(),
    ci: {
      repository: "Tabriage/EvolveDesk",
      commit: "a".repeat(40),
      ref: "refs/heads/main",
      workflowPath: ".github/workflows/deploy-aws-storage-broker.yml",
      runId: "123456789",
      runAttempt: 1,
      runUrl: "https://github.com/Tabriage/EvolveDesk/actions/runs/123456789",
      environment: "storage-broker-production",
    },
    cloud: {
      region: "us-east-1",
      resourceArn: "arn:aws:lambda:us-east-1:123456789012:function:evolve-desk-storage-credential-broker",
      immutableVersion: "7",
      endpointOrigin: "https://example.lambda-url.us-east-1.on.aws",
      codeDigest: { value: Buffer.alloc(32, 7).toString("base64") },
      observedAt: "2026-08-21T09:59:30.000Z",
    },
  };
}

test("deployment proof binds GitHub OIDC run, source proof, and immutable Lambda version", async () => {
  const proof = await createStorageBrokerDeploymentProof(await input());
  assert.equal(proof.body.ci.credentialMode, "github-oidc");
  assert.equal(proof.body.ci.artifactAttestation.verificationRequired, true);
  assert.equal(proof.body.cloud.immutableVersion, "7");
  assert.equal(proof.body.cloud.codeDigest.encoding, "base64");
  assert.deepEqual(await inspectStorageBrokerDeploymentProof(proof), proof);
  assert.deepEqual(await inspectStorageBrokerDeploymentProofText(await serializeStorageBrokerDeploymentProof(proof)), proof);
});

test("deployment proof rejects source, CI, endpoint, version, digest, and hidden-field mutations", async () => {
  const value = await input();
  const proof = await createStorageBrokerDeploymentProof(value);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, ci: { ...value.ci, commit: "b".repeat(40) } }), /提交与发布封签/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, ci: { ...value.ci, ref: "refs/heads/other" } }), /Ref 与发布封签/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, ci: { ...value.ci, workflowPath: ".github/workflows/other.yml" } }), /工作流不受支持/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, ci: { ...value.ci, environment: "unprotected" } }), /Environment 不受支持/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, ci: { ...value.ci, runUrl: "https://github.com/Tabriage/EvolveDesk/actions/runs/2" } }), /运行地址/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, immutableVersion: "$LATEST" } }), /不可变版本/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, endpointOrigin: "https://other.lambda-url.us-east-1.on.aws" } }), /端点与发布封签/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, codeDigest: { value: "x".repeat(44) } } }), /CodeSha256/);
  await assert.rejects(createStorageBrokerDeploymentProof({ ...value, cloud: { ...value.cloud, observedAt: "2026-08-21T10:06:00.000Z" } }), /时间顺序/);
  await assert.rejects(inspectStorageBrokerDeploymentProof({ ...proof, hidden: true }), /字段、云端版本|SHA-256/);
  await assert.rejects(inspectStorageBrokerDeploymentProof({ ...proof, digest: { ...proof.digest, value: "f".repeat(64) } }), /SHA-256/);
});

test("deployment proof parser stays bounded", async () => {
  await assert.rejects(inspectStorageBrokerDeploymentProofText("x".repeat(256 * 1024 + 1)), /256 KiB/);
  await assert.rejects(inspectStorageBrokerDeploymentProofText("not-json"), /有效 JSON/);
});

function githubRun(overrides = {}) {
  return {
    id: 123456789,
    run_attempt: 1,
    html_url: "https://github.com/Tabriage/EvolveDesk/actions/runs/123456789",
    event: "workflow_dispatch",
    path: ".github/workflows/deploy-aws-storage-broker.yml",
    head_sha: "a".repeat(40),
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-21T09:55:00Z",
    updated_at: "2026-08-21T10:10:00Z",
    repository: { full_name: "Tabriage/EvolveDesk" },
    ...overrides,
  };
}

function runResponse(value, headers = {}) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return { status: 200, headers: { get: (name) => headers[name.toLowerCase()] || null }, text: async () => raw };
}

test("online run verification confirms the exact public GitHub workflow run without credentials", async () => {
  const proof = await createStorageBrokerDeploymentProof(await input());
  let request;
  const result = await verifyStorageBrokerDeploymentRun(proof, {
    now: "2026-08-21T10:11:00.000Z",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return runResponse(githubRun());
    },
  });
  assert.equal(request.url, "https://api.github.com/repos/Tabriage/EvolveDesk/actions/runs/123456789");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(result.conclusion, "success");
  assert.equal(result.commit, "a".repeat(40));
  assert.equal(result.checkedAt, "2026-08-21T10:11:00.000Z");
});

test("online run verification rejects failed, mismatched, malformed, oversized, and out-of-window runs", async () => {
  const proof = await createStorageBrokerDeploymentProof(await input());
  const verify = (value, headers) => verifyStorageBrokerDeploymentRun(proof, { fetchImpl: async () => runResponse(value, headers) });
  await assert.rejects(verify(githubRun({ conclusion: "failure" })), /conclusion/);
  await assert.rejects(verify(githubRun({ head_sha: "b".repeat(40) })), /commit/);
  await assert.rejects(verify(githubRun({ repository: { full_name: "attacker/fork" } })), /repository/);
  await assert.rejects(verify(githubRun({ created_at: "2026-08-21T10:06:00Z" })), /时间窗口/);
  await assert.rejects(verify("not-json"), /有效 JSON/);
  await assert.rejects(verify("{}", { "content-length": String(128 * 1024 + 1) }), /128 KiB/);
  await assert.rejects(verifyStorageBrokerDeploymentRun(proof, { fetchImpl: async () => ({ status: 404, headers: { get: () => null }, text: async () => "" }) }), /HTTP 404/);
});

test("workflows pin actions, minimize token permissions, and keep cloud credentials out of source", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const deploy = readFileSync(".github/workflows/deploy-aws-storage-broker.yml", "utf8");
  const trust = readFileSync("deploy/storage-broker/aws-lambda/github-oidc-role-template.yaml", "utf8");
  const cloudflare = readFileSync("deploy/storage-broker/cloudflare/WORKERS_BUILDS.md", "utf8");
  for (const workflow of [ci, deploy]) {
    for (const use of workflow.matchAll(/uses:\s+([^\s#]+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/);
    assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
  }
  assert.match(ci, /pnpm install --frozen-lockfile/);
  assert.match(ci, /pnpm audit --audit-level=moderate/);
  assert.match(deploy, /environment: storage-broker-production/);
  assert.match(deploy, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /attestations: write/);
  assert.doesNotMatch(deploy, /CLOUDFLARE_API_TOKEN/);
  assert.match(trust, /token\.actions\.githubusercontent\.com:aud["']?: sts\.amazonaws\.com/);
  assert.match(trust, /repo:Tabriage@306264537\/EvolveDesk@1323515722:environment:storage-broker-production/);
  assert.doesNotMatch(trust, /token\.actions\.githubusercontent\.com:sub[^\n]*\*/);
  assert.match(cloudflare, /It is not OIDC/);
  assert.match(cloudflare, /long-lived cloud-side credentials/);
});
