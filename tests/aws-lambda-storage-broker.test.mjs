import assert from "node:assert/strict";
import test from "node:test";
import { createCredentialBrokerRequest } from "../app/features/sync-credential-broker.mjs";
import { handleAwsLambdaBrokerEvent } from "../deploy/storage-broker/aws-lambda/handler.mjs";

const env = {
  ALLOWED_ORIGIN: "https://desk.example",
  BROKER_TOKEN: "lambda-broker-token-example",
  EVOLVE_AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/EvolveDeskCredentialRole",
  EVOLVE_AWS_REGION: "ap-southeast-1",
  EVOLVE_AWS_EXTERNAL_ID: "",
  AWS_ACCESS_KEY_ID: "AKIAEXAMPLE1234567",
  AWS_SECRET_ACCESS_KEY: "parent-secret-access-key-example",
  AWS_SESSION_TOKEN: "lambda-execution-session-token",
};

function event(method, path, body, headers = {}) {
  return {
    version: "2.0",
    rawPath: path,
    rawQueryString: "",
    headers: {
      origin: "https://desk.example",
      authorization: "Bearer lambda-broker-token-example",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    requestContext: { http: { method, path } },
    body: body ? JSON.stringify(body) : "",
    isBase64Encoded: false,
  };
}

test("AWS Lambda broker signs AssumeRole with execution-role credentials and exact policy", async () => {
  const request = createCredentialBrokerRequest({
    provider: "amazon-s3",
    bucket: "private-sync",
    objectKey: "evolve-desk/channel.json",
    region: "ap-southeast-1",
    ttlSeconds: 900,
  });
  const calls = [];
  const result = await handleAwsLambdaBrokerEvent(event("POST", "/credentials", request), env, {
    now: "2026-08-21T10:00:00.000Z",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(`<AssumeRoleResponse><AssumeRoleResult><Credentials>
        <AccessKeyId>ASIAEXAMPLE123456</AccessKeyId>
        <SecretAccessKey>temporary-secret-access-key</SecretAccessKey>
        <SessionToken>temporary-session-token</SessionToken>
        <Expiration>2026-08-21T10:15:00.000Z</Expiration>
      </Credentials></AssumeRoleResult></AssumeRoleResponse>`, { status: 200 });
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["Access-Control-Allow-Origin"], "https://desk.example");
  const params = new URLSearchParams(calls[0].options.body);
  assert.equal(calls[0].url, "https://sts.ap-southeast-1.amazonaws.com/");
  assert.match(calls[0].options.headers.Authorization, /\/ap-southeast-1\/sts\/aws4_request/);
  assert.equal(JSON.parse(params.get("Policy")).Statement[0].Resource, "arn:aws:s3:::private-sync/evolve-desk/channel.json");
  assert.equal(JSON.parse(result.body).credentials.sessionToken, "temporary-session-token");
});

test("AWS Lambda broker validates Function URL v2, origin, bearer, and provider", async () => {
  const health = await handleAwsLambdaBrokerEvent(event("GET", "/health"), env);
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body).providers, { cloudflareR2: false, amazonS3: true });

  const legacy = await handleAwsLambdaBrokerEvent({ ...event("GET", "/health"), version: "1.0" }, env);
  assert.equal(legacy.statusCode, 400);

  const wrongOrigin = await handleAwsLambdaBrokerEvent(event("GET", "/health", null, { origin: "https://evil.example" }), env);
  assert.equal(wrongOrigin.statusCode, 403);

  const wrongToken = await handleAwsLambdaBrokerEvent(event("GET", "/health", null, { authorization: "Bearer wrong-token-value" }), env);
  assert.equal(wrongToken.statusCode, 401);

  const r2Request = createCredentialBrokerRequest({
    provider: "cloudflare-r2",
    accountId: "a".repeat(32),
    bucket: "private-sync",
    objectKey: "evolve-desk/channel.json",
    region: "auto",
    ttlSeconds: 900,
  });
  const awsOnly = await handleAwsLambdaBrokerEvent(event("POST", "/credentials", r2Request), env);
  assert.equal(awsOnly.statusCode, 400);
  assert.match(JSON.parse(awsOnly.body).error, /只签发 Amazon S3/);
});
