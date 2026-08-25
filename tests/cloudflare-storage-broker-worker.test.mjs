import assert from "node:assert/strict";
import test from "node:test";
import { createCredentialBrokerRequest } from "../app/features/sync-credential-broker.mjs";
import { handleCloudflareBrokerRequest } from "../deploy/storage-broker/cloudflare/worker.mjs";
import { issueR2TemporaryCredentials } from "../tools/storage-credential-issuers.mjs";

const accountId = "a".repeat(32);
const env = {
  ALLOWED_ORIGIN: "https://desk.example",
  BROKER_TOKEN: "worker-broker-token-example",
  R2_ACCOUNT_ID: accountId,
  R2_ACCESS_KEY_ID: "R2PARENTACCESS123",
  R2_SECRET_ACCESS_KEY: "r2-parent-secret-example",
  EVOLVE_RELEASE_REPOSITORY: "Tabriage/EvolveDesk",
  EVOLVE_RELEASE_COMMIT: "a".repeat(40),
  EVOLVE_RELEASE_BRANCH: "main",
  EVOLVE_CLOUDFLARE_BUILD_UUID: "12345678-1234-4234-8234-123456789abc",
  CF_VERSION_METADATA: {
    id: "11111111-2222-4333-8444-555555555555",
    tag: `evolve-${"a".repeat(40)}`,
    timestamp: "2026-08-21T09:59:30.000Z",
  },
};
const request = createCredentialBrokerRequest({
  provider: "cloudflare-r2",
  accountId,
  bucket: "private-sync",
  objectKey: "evolve-desk/channel.json",
  region: "auto",
  ttlSeconds: 900,
});

test("Cloudflare Worker broker matches the local R2 signing implementation", async () => {
  const now = new Date("2026-08-21T10:00:00.000Z");
  const response = await handleCloudflareBrokerRequest(new Request("https://broker.example/credentials", {
    method: "POST",
    headers: {
      Origin: "https://desk.example",
      Authorization: "Bearer worker-broker-token-example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  }), env, now);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://desk.example");
  assert.deepEqual(await response.json(), issueR2TemporaryCredentials(request, {
    accountId,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }, now));
});

test("Cloudflare Worker broker requires exact origin, bearer, provider, and path", async () => {
  const health = await handleCloudflareBrokerRequest(new Request("https://broker.example/health", {
    headers: { Origin: "https://desk.example", Authorization: "Bearer worker-broker-token-example" },
  }), env);
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()).providers, { cloudflareR2: true, amazonS3: false });

  const wrongOrigin = await handleCloudflareBrokerRequest(new Request("https://broker.example/health", {
    headers: { Origin: "https://evil.example", Authorization: "Bearer worker-broker-token-example" },
  }), env);
  assert.equal(wrongOrigin.status, 403);

  const wrongToken = await handleCloudflareBrokerRequest(new Request("https://broker.example/health", {
    headers: { Origin: "https://desk.example", Authorization: "Bearer wrong-token-value" },
  }), env);
  assert.equal(wrongToken.status, 401);

  const r2Only = await handleCloudflareBrokerRequest(new Request("https://broker.example/credentials", {
    method: "POST",
    headers: { Origin: "https://desk.example", Authorization: "Bearer worker-broker-token-example", "Content-Type": "application/json" },
    body: JSON.stringify(createCredentialBrokerRequest({
      provider: "amazon-s3",
      bucket: "private-sync",
      objectKey: "evolve-desk/channel.json",
      region: "us-east-1",
      ttlSeconds: 900,
    })),
  }), env);
  assert.equal(r2Only.status, 400);
  assert.match((await r2Only.json()).error, /只签发 R2/);

  const query = await handleCloudflareBrokerRequest(new Request("https://broker.example/health?debug=1", {
    headers: { Origin: "https://desk.example", Authorization: "Bearer worker-broker-token-example" },
  }), env);
  assert.equal(query.status, 404);
});

test("Cloudflare Worker health binds build metadata, Version ID, and a fresh challenge", async () => {
  const challengeValue = "0123456789abcdef".repeat(4);
  const health = await handleCloudflareBrokerRequest(new Request("https://broker.example/health", {
    headers: {
      Origin: "https://desk.example",
      Authorization: "Bearer worker-broker-token-example",
      "X-Evolve-Runtime-Challenge": challengeValue,
    },
  }), env);
  assert.equal(health.status, 200);
  assert.match(health.headers.get("access-control-allow-headers"), /X-Evolve-Runtime-Challenge/);
  const body = await health.json();
  assert.equal(body.release.ci.commit, "a".repeat(40));
  assert.equal(body.release.ci.buildUuid, "12345678-1234-4234-8234-123456789abc");
  assert.equal(body.release.runtime.versionId, "11111111-2222-4333-8444-555555555555");
  assert.equal(body.challenge.value, challengeValue);
  assert.match(body.challenge.digest, /^[0-9a-f]{64}$/);

  const malformed = await handleCloudflareBrokerRequest(new Request("https://broker.example/health", {
    headers: {
      Origin: "https://desk.example",
      Authorization: "Bearer worker-broker-token-example",
      "X-Evolve-Runtime-Challenge": "predictable",
    },
  }), env);
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /挑战/);
});
