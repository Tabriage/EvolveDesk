import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createCredentialBrokerRequest } from "../app/features/sync-credential-broker.mjs";
import {
  issueAwsTemporaryCredentials,
  issueR2TemporaryCredentials,
  validateAwsIssuerConfig,
  validateR2IssuerConfig,
} from "../tools/storage-credential-issuers.mjs";

const accountId = "a".repeat(32);
const r2Request = createCredentialBrokerRequest({
  provider: "cloudflare-r2",
  accountId,
  bucket: "private-sync",
  objectKey: "evolve-desk/channel.json",
  region: "auto",
  ttlSeconds: 900,
});

test("R2 local issuer follows the documented JWT-derived credential format", () => {
  const parentSecret = "r2-parent-secret-example";
  const result = issueR2TemporaryCredentials(r2Request, {
    accountId,
    accessKeyId: "R2PARENTACCESS123",
    secretAccessKey: parentSecret,
  }, "2026-08-21T10:00:00.000Z");
  const tokenText = Buffer.from(result.credentials.sessionToken, "base64").toString("utf8");
  assert.match(tokenText, /^jwt\//);
  const jwt = tokenText.slice(4);
  const [headerPart, payloadPart, signature] = jwt.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
  assert.deepEqual(payload.actions, ["GetObject", "PutObject"]);
  assert.deepEqual(payload.paths, { prefixPaths: [], objectPaths: ["evolve-desk/channel.json"] });
  assert.equal(payload.sub, accountId);
  assert.equal(payload.aud, `${accountId}.r2.cloudflarestorage.com`);
  assert.equal(payload.exp - payload.iat, 900);
  assert.equal(signature, createHmac("sha256", parentSecret).update(`${headerPart}.${payloadPart}`).digest("base64url"));
  assert.equal(result.credentials.secretAccessKey, createHash("sha256").update(jwt).digest("hex"));
  assert.equal(result.credentials.expiresAt, "2026-08-21T10:15:00.000Z");
});

test("issuer configuration is validated before health can report it enabled", () => {
  assert.throws(() => validateR2IssuerConfig({ accountId: "not-an-account", accessKeyId: "ACCESSKEY123", secretAccessKey: "secret-key-example" }), /Account ID/);
  assert.throws(() => validateAwsIssuerConfig({ roleArn: "arn:aws:iam::bad:role/example", accessKeyId: "AKIAEXAMPLE1234567", secretAccessKey: "secret-key-example" }), /Role ARN/);
});

test("AWS issuer signs AssumeRole with an exact-object inline session policy", async () => {
  const request = createCredentialBrokerRequest({
    provider: "amazon-s3",
    bucket: "private-sync",
    objectKey: "evolve-desk/channel.json",
    region: "ap-southeast-1",
    ttlSeconds: 900,
  });
  const calls = [];
  const result = await issueAwsTemporaryCredentials(request, {
    roleArn: "arn:aws:iam::123456789012:role/EvolveDeskCredentialRole",
    accessKeyId: "AKIAEXAMPLE1234567",
    secretAccessKey: "parent-secret-access-key-example",
    region: "ap-southeast-1",
    sessionName: "evolve-desk-test",
  }, {
    now: "2026-08-21T10:00:00.000Z",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(`<?xml version="1.0"?><AssumeRoleResponse><AssumeRoleResult><Credentials>
        <AccessKeyId>ASIAEXAMPLE123456</AccessKeyId>
        <SecretAccessKey>temporary-secret-access-key</SecretAccessKey>
        <SessionToken>temporary-session-token</SessionToken>
        <Expiration>2026-08-21T10:15:00.000Z</Expiration>
      </Credentials></AssumeRoleResult></AssumeRoleResponse>`, { status: 200 });
    },
  });
  const params = new URLSearchParams(calls[0].options.body);
  assert.equal(calls[0].url, "https://sts.ap-southeast-1.amazonaws.com/");
  assert.match(calls[0].options.headers.Authorization, /\/ap-southeast-1\/sts\/aws4_request/);
  assert.deepEqual(JSON.parse(params.get("Policy")), {
    Version: "2012-10-17",
    Statement: [{
      Sid: "EvolveDeskExactObject",
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject"],
      Resource: "arn:aws:s3:::private-sync/evolve-desk/channel.json",
    }],
  });
  assert.equal(params.get("DurationSeconds"), "900");
  assert.deepEqual(result.credentials, {
    accessKeyId: "ASIAEXAMPLE123456",
    secretAccessKey: "temporary-secret-access-key",
    sessionToken: "temporary-session-token",
    expiresAt: "2026-08-21T10:15:00.000Z",
  });
});
