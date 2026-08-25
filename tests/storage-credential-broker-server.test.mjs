import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { createCredentialBrokerRequest } from "../app/features/sync-credential-broker.mjs";

const accountId = "a".repeat(32);

async function startServer() {
  const child = spawn(process.execPath, ["tools/storage-credential-broker.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      EVOLVE_STORAGE_BROKER_PORT: "0",
      EVOLVE_STORAGE_BROKER_ORIGIN: "http://localhost:3000",
      EVOLVE_STORAGE_BROKER_TOKEN: "broker-test-token",
      EVOLVE_R2_ACCOUNT_ID: accountId,
      EVOLVE_R2_ACCESS_KEY_ID: "R2PARENTACCESS123",
      EVOLVE_R2_SECRET_ACCESS_KEY: "r2-parent-secret-example",
      EVOLVE_AWS_ROLE_ARN: "",
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      AWS_SESSION_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("storage credential broker did not start")), 8_000);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`storage credential broker exited ${code}`)));
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  return { child, port };
}

test("loopback credential broker enforces origin, auth, and exact R2 scope", async (context) => {
  const { child, port } = await startServer();
  context.after(() => child.kill("SIGTERM"));
  const url = `http://127.0.0.1:${port}`;
  const auth = { Authorization: "Bearer broker-test-token" };

  const health = await fetch(`${url}/health`, { headers: { ...auth, Origin: "http://localhost:3000" } });
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()).providers, { cloudflareR2: true, amazonS3: false });
  assert.equal(health.headers.get("access-control-allow-origin"), "http://localhost:3000");

  const denied = await fetch(`${url}/health`, { headers: { Origin: "https://evil.example" } });
  assert.equal(denied.status, 403);

  const request = createCredentialBrokerRequest({
    provider: "cloudflare-r2",
    accountId,
    bucket: "private-sync",
    objectKey: "evolve-desk/channel.json",
    region: "auto",
    ttlSeconds: 900,
  });
  const issued = await fetch(`${url}/credentials`, {
    method: "POST",
    headers: { ...auth, Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(issued.status, 200);
  const result = await issued.json();
  assert.equal(result.credentials.accessKeyId, "R2PARENTACCESS123");
  assert.match(Buffer.from(result.credentials.sessionToken, "base64").toString("utf8"), /^jwt\//);

  const broadened = await fetch(`${url}/credentials`, {
    method: "POST",
    headers: { ...auth, Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, scope: { ...request.scope, operations: ["GetObject", "PutObject", "DeleteObject"] } }),
  });
  assert.equal(broadened.status, 400);
  assert.match((await broadened.json()).error, /不等价/);
});
