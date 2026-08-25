import assert from "node:assert/strict";
import test from "node:test";
import {
  createAwsS3SessionPolicy,
  createR2LocalCredentialClaims,
  createSyncStorageScopeTicket,
  inspectSyncStorageScopeTicket,
  serializeSyncStorageScopeTicket,
} from "../app/features/sync-storage-scope.mjs";

const target = {
  accountId: "a".repeat(32),
  bucket: "private-sync",
  objectKey: "evolve-desk/channel.json",
  region: "auto",
  ttlSeconds: 900,
};

test("R2 scope ticket binds local signing claims to one object and GET/PUT", () => {
  const ticket = createSyncStorageScopeTicket("cloudflare-r2", target);
  assert.deepEqual(ticket.providerPolicy, {
    bucket: "private-sync",
    scope: "object-read-write",
    actions: ["GetObject", "PutObject"],
    paths: { prefixPaths: [], objectPaths: ["evolve-desk/channel.json"] },
  });
  assert.deepEqual(createR2LocalCredentialClaims(target), ticket.providerPolicy);
  assert.deepEqual(inspectSyncStorageScopeTicket(ticket), ticket);
  assert.equal(JSON.parse(serializeSyncStorageScopeTicket(ticket)).target.objectKey, target.objectKey);
});

test("AWS scope ticket emits a single exact object session policy", () => {
  const value = { ...target, accountId: undefined, region: "ap-southeast-1" };
  const ticket = createSyncStorageScopeTicket("amazon-s3", value);
  assert.deepEqual(ticket.providerPolicy, {
    Version: "2012-10-17",
    Statement: [{
      Sid: "EvolveDeskExactObject",
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject"],
      Resource: "arn:aws:s3:::private-sync/evolve-desk/channel.json",
    }],
  });
  assert.deepEqual(createAwsS3SessionPolicy(value), ticket.providerPolicy);
});

test("scope ticket inspector rejects broad or mutated permissions", () => {
  const ticket = createSyncStorageScopeTicket("cloudflare-r2", target);
  assert.throws(() => inspectSyncStorageScopeTicket({ ...ticket, operations: ["GetObject", "PutObject", "DeleteObject"] }), /不等价/);
  assert.throws(() => inspectSyncStorageScopeTicket({ ...ticket, providerPolicy: { ...ticket.providerPolicy, paths: { prefixPaths: ["evolve-desk/"], objectPaths: [] } } }), /不等价/);
  assert.throws(() => inspectSyncStorageScopeTicket({ ...ticket, extra: true }), /不等价/);
  assert.throws(() => createSyncStorageScopeTicket("amazon-s3", { ...target, region: "us-east-1", objectKey: "evolve-desk/*" }), /通配符/);
  assert.throws(() => createSyncStorageScopeTicket("amazon-s3", { ...target, region: "us-east-1", objectKey: "evolve-desk/${aws:username}.json" }), /策略变量/);
  assert.throws(() => createSyncStorageScopeTicket("amazon-s3", { ...target, region: "us-east-1", ttlSeconds: 300 }), /900–43200/);
  assert.throws(() => createSyncStorageScopeTicket("amazon-s3", { ...target, region: "us-east-1", ttlSeconds: 43201 }), /900–43200/);
});
