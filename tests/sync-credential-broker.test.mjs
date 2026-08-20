import assert from "node:assert/strict";
import test from "node:test";
import {
  createCredentialBrokerRequest,
  normalizeCredentialBrokerResponse,
  renewSyncStorageCredentials,
} from "../app/features/sync-credential-broker.mjs";

const r2Scope = {
  provider: "cloudflare-r2",
  accountId: "a".repeat(32),
  bucket: "private-sync",
  objectKey: "evolve-desk/channel.json",
  region: "auto",
  ttlSeconds: 900,
};

test("credential broker requests only the current object and GET/PUT intent", () => {
  const request = createCredentialBrokerRequest(r2Scope);
  assert.deepEqual(request.scope.operations, ["GetObject", "PutObject"]);
  assert.equal(request.scope.objectKey, "evolve-desk/channel.json");
  assert.equal(request.ttlSeconds, 900);
  assert.equal(JSON.stringify(request).includes("secretAccessKey"), false);
  assert.throws(() => createCredentialBrokerRequest({ ...r2Scope, ttlSeconds: 60 }), /300–604800/);
});

test("credential broker accepts a Cloudflare result and derives expiry from requested TTL", async () => {
  const calls = [];
  const result = await renewSyncStorageCredentials({
    endpointUrl: "https://credentials.example/evolve-desk/renew",
    bearerToken: "broker-memory-token",
  }, r2Scope, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      success: true,
      result: {
        accessKeyId: "TEMPACCESSKEY123",
        secretAccessKey: "temporary-secret-access-key",
        sessionToken: "temporary-session-token",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, () => new Date("2026-08-21T10:00:00.000Z"));

  assert.equal(result.credentials.expiresAt, "2026-08-21T10:15:00.000Z");
  assert.equal(result.credentials.region, "auto");
  assert.equal(calls[0].options.headers.Authorization, "Bearer broker-memory-token");
  assert.equal(calls[0].options.body.includes("broker-memory-token"), false);
  assert.equal(calls[0].options.body.includes("temporary-secret-access-key"), false);
  assert.equal(calls[0].options.redirect, "error");
});

test("credential broker normalizes AWS Credentials expiration and rejects non-session responses", () => {
  const request = createCredentialBrokerRequest({
    provider: "amazon-s3",
    bucket: "private-sync",
    objectKey: "evolve-desk/channel.json",
    region: "ap-southeast-1",
    ttlSeconds: 900,
  });
  const credentials = normalizeCredentialBrokerResponse({
    Credentials: {
      AccessKeyId: "ASIAEXAMPLE12345",
      SecretKey: "temporary-secret-access-key",
      SessionToken: "temporary-session-token",
      Expiration: 1787307300,
    },
  }, request, "2026-08-21T10:00:00.000Z");

  assert.equal(credentials.expiresAt, "2026-08-21T10:15:00.000Z");
  assert.equal(credentials.region, "ap-southeast-1");
  assert.throws(() => normalizeCredentialBrokerResponse({ credentials: {
    accessKeyId: "ACCESSKEY123",
    secretAccessKey: "temporary-secret-access-key",
    expiresAt: "2026-08-21T10:15:00.000Z",
  } }, request, "2026-08-21T10:00:00.000Z"), /Session Token/);
  assert.throws(() => normalizeCredentialBrokerResponse({ credentials: {
    accessKeyId: "ACCESSKEY123",
    secretAccessKey: "temporary-secret-access-key",
    sessionToken: "temporary-session-token",
    expiresAt: "2026-08-21T11:00:00.000Z",
  } }, request, "2026-08-21T10:00:00.000Z"), /超过本次申请寿命/);
});
