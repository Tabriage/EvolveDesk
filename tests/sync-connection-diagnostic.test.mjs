import assert from "node:assert/strict";
import test from "node:test";
import {
  createSyncConnectionDiagnostic,
  inspectSyncConnectionDiagnosticText,
  serializeSyncConnectionDiagnostic,
} from "../app/features/sync-connection-diagnostic.mjs";

const secret = "temporary-secret-access-key";
const token = "temporary-session-token";
const objectUrl = "https://private-sync.s3.ap-southeast-1.amazonaws.com/evolve-desk/channel.json";

test("connection diagnostics seal only redacted target, credential, probe, and contract evidence", async () => {
  const diagnostic = await createSyncConnectionDiagnostic({
    recipeId: "amazon-s3",
    objectUrl,
    region: "ap-southeast-1",
    accessKeyId: "ASIAEXAMPLE12345",
    secretAccessKey: secret,
    sessionToken: token,
    expiresAt: "2026-08-21T10:30:00.000Z",
    credentialSource: "broker",
    probe: {
      status: "etag-ready",
      checkedAt: "2026-08-21T10:01:00.000Z",
      revisionId: "revision-sensitive-identifier",
      validator: '"remote-etag"',
    },
  }, "2026-08-21T10:02:00.000Z");
  const serialized = serializeSyncConnectionDiagnostic(diagnostic);
  const inspection = await inspectSyncConnectionDiagnosticText(serialized);

  assert.equal(inspection.sealed, true);
  assert.equal(diagnostic.body.credential.lifecycle, "valid");
  assert.equal(diagnostic.body.probe.status, "etag-ready");
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(objectUrl), false);
  assert.equal(serialized.includes("revision-sensitive-identifier"), false);
  assert.equal(serialized.includes("remote-etag"), false);
});

test("connection diagnostic inspection rejects hidden fields and seal tampering", async () => {
  const diagnostic = await createSyncConnectionDiagnostic({
    recipeId: "http-gateway",
    objectUrl: "https://sync.example/evolve.json",
    probe: { status: "error", checkedAt: "2026-08-21T10:01:00.000Z", failureCode: "network-or-cors" },
  }, "2026-08-21T10:02:00.000Z");
  const tampered = structuredClone(diagnostic);
  tampered.body.probe.status = "etag-ready";
  await assert.rejects(inspectSyncConnectionDiagnosticText(JSON.stringify(tampered)), /错误分类无效|封签不匹配/);

  const hidden = structuredClone(diagnostic);
  hidden.body.credential.secretAccessKey = secret;
  await assert.rejects(inspectSyncConnectionDiagnosticText(JSON.stringify(hidden)), /未声明字段/);
});
