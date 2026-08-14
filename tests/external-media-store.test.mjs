import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createExternalMediaFullHash } from "../app/features/external-media-hash.mjs";
import { createExternalMediaDuplicateReport, createExternalMediaFingerprint, createExternalMediaRecord, planExternalMediaRelocations, verifyExternalMediaFile } from "../app/features/external-media-store.mjs";

function mediaFile(parts, name = "课程录像.mp4", lastModified = 1_787_120_000_000) {
  return new File(parts, name, { type: "video/mp4", lastModified });
}

test("external media fingerprints are stable for the same bounded samples", async () => {
  const first = mediaFile([new Uint8Array(150_000).fill(7)]);
  const second = mediaFile([new Uint8Array(150_000).fill(7)]);

  assert.equal(await createExternalMediaFingerprint(first), await createExternalMediaFingerprint(second));
});

test("external media verification catches metadata and tail changes", async () => {
  const originalBytes = new Uint8Array(150_000).fill(3);
  const original = mediaFile([originalBytes]);
  const handle = { kind: "file", getFile: async () => original };
  const record = await createExternalMediaRecord("local-media://upload_original_01", original, handle, "2026-08-21T08:00:00.000Z");
  const changedBytes = originalBytes.slice();
  changedBytes[changedBytes.length - 1] = 9;

  assert.equal(await verifyExternalMediaFile(record, mediaFile([originalBytes])), true);
  assert.equal(await verifyExternalMediaFile(record, mediaFile([changedBytes])), false);
  assert.equal(await verifyExternalMediaFile(record, mediaFile([originalBytes], "另一个文件.mp4")), false);
  assert.match(record.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(record).includes("handle"), true);
});

test("external media records reject non-local sources and missing handles", async () => {
  const file = mediaFile([new Uint8Array([1, 2, 3])]);
  await assert.rejects(createExternalMediaRecord("https://example.com/video", file, { kind: "file", getFile: async () => file }), /本地媒体来源/);
  await assert.rejects(createExternalMediaRecord("local-media://upload_original_01", file, null), /文件句柄/);
});

test("full media hashing streams exact SHA-256 content across chunk boundaries", async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024 + 137);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  const file = mediaFile([bytes], "跨块录像.mp4");
  const progress = [];
  const digest = await createExternalMediaFullHash(file, (processed, total) => progress.push([processed, total]));

  assert.equal(digest, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(progress.at(-1), [bytes.length, bytes.length]);
  assert.equal(progress.length, 2);
});

test("full media hashing can wait at a chunk boundary before reading", async () => {
  const file = mediaFile([new Uint8Array([9, 8, 7])], "暂停队列.mp4");
  let release;
  let progressed = false;
  const hashing = createExternalMediaFullHash(file, () => { progressed = true; }, {
    waitIfPaused: () => new Promise((resolve) => { release = resolve; }),
  });

  assert.equal(progressed, false);
  release();
  assert.equal(await hashing, createHash("sha256").update(new Uint8Array([9, 8, 7])).digest("hex"));
  assert.equal(progressed, true);
});

test("full media hashing rejects files above the external index limit before reading", async () => {
  let sliced = false;
  const oversized = {
    size: 500 * 1024 * 1024 + 1,
    slice() {
      sliced = true;
      throw new Error("should not read");
    },
  };

  await assert.rejects(createExternalMediaFullHash(oversized), /500MB/);
  assert.equal(sliced, false);
});

test("full hashing detects middle-only changes that bounded sampling intentionally misses", async () => {
  const originalBytes = new Uint8Array(150_000).fill(5);
  const changedBytes = originalBytes.slice();
  changedBytes[75_000] = 8;
  const original = mediaFile([originalBytes]);
  const changed = mediaFile([changedBytes]);

  assert.equal(await createExternalMediaFingerprint(original), await createExternalMediaFingerprint(changed));
  assert.notEqual(await createExternalMediaFullHash(original), await createExternalMediaFullHash(changed));
});

test("duplicate reports require a complete hash and never infer from sampled evidence", () => {
  const duplicateHash = "a".repeat(64);
  const report = createExternalMediaDuplicateReport([
    { sourceKey: "local-media://duplicate_first_01", name: "原文件.mp4", size: 120, fullHash: duplicateHash },
    { sourceKey: "local-media://duplicate_second_02", name: "副本.mov", size: 120, fullHash: duplicateHash },
    { sourceKey: "local-media://same_sample_only_03", name: "只有采样.mp4", size: 120, fingerprint: duplicateHash, fullHash: "" },
    { sourceKey: "local-media://different_size_04", name: "不同大小.mp4", size: 121, fullHash: duplicateHash },
  ]);

  assert.equal(report.hashedRecords, 3);
  assert.equal(report.duplicateRecords, 2);
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].size, 120);
  assert.deepEqual(report.groups[0].records.map((record) => record.name), ["副本.mov", "原文件.mp4"]);
});

test("batch relocation uses unique sample matches and full hashes for renamed files", () => {
  const plan = planExternalMediaRelocations([
    { sourceKey: "local-media://source_exact_01", name: "原片.mp4", size: 100, lastModified: 10, fingerprint: "a".repeat(64), fullHash: "" },
    { sourceKey: "local-media://source_renamed_02", name: "旧名称.mov", size: 200, lastModified: 20, fingerprint: "b".repeat(64), fullHash: "f".repeat(64) },
  ], [
    { candidateId: "candidate_0", name: "原片.mp4", size: 100, lastModified: 10, fingerprint: "a".repeat(64), fullHash: "" },
    { candidateId: "candidate_1", name: "整理后的名称.mov", size: 200, lastModified: 30, fingerprint: "c".repeat(64), fullHash: "f".repeat(64) },
  ]);

  assert.deepEqual(plan.matches, [
    { sourceKey: "local-media://source_exact_01", candidateId: "candidate_0", method: "sample" },
    { sourceKey: "local-media://source_renamed_02", candidateId: "candidate_1", method: "full" },
  ]);
  assert.deepEqual(plan.unresolvedSourceKeys, []);
});

test("batch relocation leaves duplicate candidates unresolved instead of guessing", () => {
  const record = { sourceKey: "local-media://source_duplicate_01", name: "重复.mp4", size: 100, lastModified: 10, fingerprint: "d".repeat(64), fullHash: "" };
  const candidate = { name: "重复.mp4", size: 100, lastModified: 10, fingerprint: "d".repeat(64), fullHash: "" };
  const plan = planExternalMediaRelocations([record], [
    { ...candidate, candidateId: "candidate_0" },
    { ...candidate, candidateId: "candidate_1" },
  ]);

  assert.deepEqual(plan.matches, []);
  assert.deepEqual(plan.unresolvedSourceKeys, [record.sourceKey]);
  assert.deepEqual(plan.unmatchedCandidateIds, ["candidate_0", "candidate_1"]);
});

test("a unique full-hash match can safely unlock the remaining sample match", () => {
  const sharedFingerprint = "e".repeat(64);
  const plan = planExternalMediaRelocations([
    { sourceKey: "local-media://source_full_first_01", name: "同名.mp4", size: 100, lastModified: 10, fingerprint: sharedFingerprint, fullHash: "1".repeat(64) },
    { sourceKey: "local-media://source_sample_after_02", name: "同名.mp4", size: 100, lastModified: 10, fingerprint: sharedFingerprint, fullHash: "" },
  ], [
    { candidateId: "candidate_full", name: "同名.mp4", size: 100, lastModified: 10, fingerprint: sharedFingerprint, fullHash: "1".repeat(64) },
    { candidateId: "candidate_sample", name: "同名.mp4", size: 100, lastModified: 10, fingerprint: sharedFingerprint, fullHash: "2".repeat(64) },
  ]);

  assert.deepEqual(plan.matches, [
    { sourceKey: "local-media://source_full_first_01", candidateId: "candidate_full", method: "full" },
    { sourceKey: "local-media://source_sample_after_02", candidateId: "candidate_sample", method: "sample" },
  ]);
  assert.deepEqual(plan.unresolvedSourceKeys, []);
});
