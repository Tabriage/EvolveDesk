import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAwsCredentialUsable,
  createAwsSigV4Headers,
  inspectAwsCredentialLifecycle,
  normalizeAwsSigV4Credentials,
} from "../app/features/aws-sigv4.mjs";

const officialCredentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

test("SigV4 matches the official Amazon S3 GET Object signature vector", async () => {
  const headers = await createAwsSigV4Headers(officialCredentials, {
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    headers: { Range: "bytes=0-9" },
  }, "2013-05-24T00:00:00.000Z");

  assert.equal(headers["x-amz-date"], "20130524T000000Z");
  assert.equal(headers["x-amz-content-sha256"], "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(headers.Authorization, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.equal(JSON.stringify(headers).includes(officialCredentials.secretAccessKey), false);
});

test("SigV4 binds temporary session credentials and conditional write headers", async () => {
  const headers = await createAwsSigV4Headers({
    ...officialCredentials,
    region: "auto",
    sessionToken: "temporary-session-token",
  }, {
    method: "PUT",
    url: "https://account.r2.cloudflarestorage.com/private-bucket/evolve%20desk.json",
    headers: { "Content-Type": "application/json;charset=utf-8", "If-None-Match": "*" },
    body: "encrypted-packet",
  }, "2026-08-21T09:10:11.000Z");

  assert.equal(headers["x-amz-security-token"], "temporary-session-token");
  assert.match(headers.Authorization, /Credential=AKIAIOSFODNN7EXAMPLE\/20260821\/auto\/s3\/aws4_request/);
  assert.match(headers.Authorization, /SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date;x-amz-security-token/);
  assert.equal(headers["if-none-match"], "*");
});

test("SigV4 credential normalization rejects control characters and invalid regions", () => {
  assert.equal(normalizeAwsSigV4Credentials(officialCredentials).sessionToken, "");
  assert.throws(() => normalizeAwsSigV4Credentials({ ...officialCredentials, secretAccessKey: "unsafe\nsecret" }), /格式无效/);
  assert.throws(() => normalizeAwsSigV4Credentials({ ...officialCredentials, region: "US East 1" }), /区域格式无效/);
});

test("temporary credential lifecycle distinguishes valid, expiring, expired, and unknown sessions", async () => {
  const now = "2026-08-21T10:00:00.000Z";
  assert.equal(inspectAwsCredentialLifecycle({ sessionToken: "session", expiresAt: "2026-08-21T10:30:00.000Z" }, now).status, "valid");
  assert.equal(inspectAwsCredentialLifecycle({ sessionToken: "session", expiresAt: "2026-08-21T10:04:00.000Z" }, now).status, "expiring");
  assert.equal(inspectAwsCredentialLifecycle({ sessionToken: "session", expiresAt: "2026-08-21T09:59:59.000Z" }, now).status, "expired");
  assert.equal(inspectAwsCredentialLifecycle({ sessionToken: "session" }, now).status, "unknown");
  assert.equal(inspectAwsCredentialLifecycle({}, now).status, "long-lived");
  assert.throws(() => assertAwsCredentialUsable({ sessionToken: "session", expiresAt: "2026-08-21T10:00:20.000Z" }, now), /不足 30 秒/);
  assert.equal(normalizeAwsSigV4Credentials({ ...officialCredentials, expiresAt: 1787308200 }).expiresAt, "2026-08-21T10:30:00.000Z");
  await assert.rejects(createAwsSigV4Headers({
    ...officialCredentials,
    sessionToken: "session",
    expiresAt: "2026-08-21T09:59:59.000Z",
  }, { method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt" }, now), /已经到期/);
});
