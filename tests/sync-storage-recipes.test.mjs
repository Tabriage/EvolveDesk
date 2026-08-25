import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNC_STORAGE_RECIPES,
  buildSyncStorageObjectUrl,
  createSyncStorageCorsPolicy,
  getSyncStorageRecipe,
} from "../app/features/sync-storage-recipes.mjs";

test("storage recipes build provider-specific single-object endpoints", () => {
  const r2 = buildSyncStorageObjectUrl("cloudflare-r2", {
    accountId: "a".repeat(32),
    bucket: "private-sync",
    objectKey: "evolve desk/channel-01.json",
  });
  const s3 = buildSyncStorageObjectUrl("amazon-s3", {
    bucket: "private-sync",
    region: "ap-southeast-1",
    objectKey: "evolve-desk/channel-01.json",
  });

  assert.equal(SYNC_STORAGE_RECIPES.length, 3);
  assert.equal(r2, `https://${"a".repeat(32)}.r2.cloudflarestorage.com/private-sync/evolve%20desk/channel-01.json`);
  assert.equal(s3, "https://private-sync.s3.ap-southeast-1.amazonaws.com/evolve-desk/channel-01.json");
  assert.equal(getSyncStorageRecipe("cloudflare-r2").region, "auto");
  assert.throws(() => buildSyncStorageObjectUrl("amazon-s3", { bucket: "Bucket.With.Dots", region: "us-east-1", objectKey: "sync.json" }), /存储桶名称/);
  assert.throws(() => buildSyncStorageObjectUrl("cloudflare-r2", { accountId: "short", bucket: "sync-bucket", objectKey: "sync.json" }), /Account ID/);
  assert.throws(() => buildSyncStorageObjectUrl("amazon-s3", { bucket: "private-sync", region: "us-east-1", objectKey: "sync/../other.json" }), /相对路径段/);
});

test("S3 CORS recipes expose only ETag and scope origins without wildcards", () => {
  const policy = createSyncStorageCorsPolicy("https://desk.example");
  const local = createSyncStorageCorsPolicy("http://localhost:3000");

  assert.deepEqual(policy[0].AllowedOrigins, ["https://desk.example"]);
  assert.deepEqual(policy[0].AllowedMethods, ["GET", "PUT"]);
  assert.deepEqual(policy[0].ExposeHeaders, ["ETag"]);
  assert.equal(policy[0].AllowedHeaders.includes("If-Match"), true);
  assert.equal(policy[0].AllowedHeaders.includes("x-amz-security-token"), true);
  assert.equal(JSON.stringify(policy).includes('"*"'), false);
  assert.deepEqual(local[0].AllowedOrigins, ["http://localhost:3000"]);
  assert.throws(() => createSyncStorageCorsPolicy("http://desk.example"), /HTTPS/);
  assert.throws(() => createSyncStorageCorsPolicy("https://desk.example/path"), /不能包含路径/);
});
