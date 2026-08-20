import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  compareExternalMediaDuplicateAuditToIndex,
  createExternalMediaDuplicateAudit,
  inspectExternalMediaDuplicateAuditText,
  serializeExternalMediaDuplicateAudit,
} from "../app/features/external-media-duplicate-audit.mjs";
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

test("duplicate audit summaries seal counts and group identity without disclosing file identifiers", async () => {
  const duplicateHash = "a".repeat(64);
  const records = [
    { sourceKey: "local-media://duplicate_audit_first_01", name: "私密原片.mp4", size: 120, fullHash: duplicateHash },
    { sourceKey: "local-media://duplicate_audit_second_02", name: "私密副本.mov", size: 120, fullHash: duplicateHash },
    { sourceKey: "local-media://duplicate_audit_unique_03", name: "独有素材.mp4", size: 80, fullHash: "b".repeat(64) },
  ];
  const receipt = await createExternalMediaDuplicateAudit(records, "2026-08-23T08:00:00.000Z");
  const serialized = serializeExternalMediaDuplicateAudit(receipt);
  const inspection = await inspectExternalMediaDuplicateAuditText(serialized);

  assert.equal(receipt.summary.indexedRecords, 3);
  assert.equal(receipt.summary.completeHashRecords, 3);
  assert.equal(receipt.summary.duplicateGroups, 1);
  assert.equal(receipt.summary.duplicateRecords, 2);
  assert.equal(receipt.summary.duplicateBytes, 240);
  assert.match(receipt.auditId, /^media_duplicate_audit_[0-9a-f]{32}$/);
  assert.match(receipt.manifest.groupSetDigest, /^[0-9a-f]{64}$/);
  assert.equal(inspection.contentIdentifiersDisclosed, false);
  assert.equal(serialized.includes("私密原片"), false);
  assert.equal(serialized.includes("duplicate_audit_first"), false);
  assert.equal(serialized.includes(duplicateHash), false);
});

test("duplicate audits compare across devices by sealed group set, not local names or source ids", async () => {
  const sharedHash = "c".repeat(64);
  const original = [
    { sourceKey: "local-media://device_one_first_01", name: "A.mp4", size: 200, fullHash: sharedHash },
    { sourceKey: "local-media://device_one_second_02", name: "B.mp4", size: 200, fullHash: sharedHash },
  ];
  const otherDevice = [
    { sourceKey: "local-media://device_two_first_001", name: "已改名甲.mov", size: 200, fullHash: sharedHash },
    { sourceKey: "local-media://device_two_second_02", name: "已改名乙.mov", size: 200, fullHash: sharedHash },
  ];
  const changedDevice = [
    otherDevice[0],
    { ...otherDevice[1], fullHash: "d".repeat(64) },
  ];
  const receipt = await createExternalMediaDuplicateAudit(original, "2026-08-23T08:10:00.000Z");
  const matching = await compareExternalMediaDuplicateAuditToIndex(receipt, otherDevice);
  const changed = await compareExternalMediaDuplicateAuditToIndex(receipt, changedDevice);

  assert.equal(matching.matches, true);
  assert.equal(matching.manifestMatches, true);
  assert.equal(changed.matches, false);
  assert.equal(changed.manifestMatches, false);
});

test("duplicate audit inspection rejects hidden fields, tampering, and missing full-hash evidence", async () => {
  const records = [
    { sourceKey: "local-media://audit_tamper_first_01", name: "第一份.mp4", size: 300, fullHash: "e".repeat(64) },
    { sourceKey: "local-media://audit_tamper_second_02", name: "第二份.mp4", size: 300, fullHash: "e".repeat(64) },
  ];
  const receipt = await createExternalMediaDuplicateAudit(records, "2026-08-23T08:20:00.000Z");
  const tampered = structuredClone(receipt);
  tampered.summary.duplicateRecords = 3;
  const hidden = structuredClone(receipt);
  hidden.fileNames = ["不应出现.mp4"];

  await assert.rejects(inspectExternalMediaDuplicateAuditText(JSON.stringify(tampered)), /统计数量关系无效|完整性封签不一致/);
  await assert.rejects(inspectExternalMediaDuplicateAuditText(JSON.stringify(hidden)), /缺失或未声明字段/);
  await assert.rejects(createExternalMediaDuplicateAudit([
    { sourceKey: "local-media://audit_unhashed_only_01", name: "未哈希.mp4", size: 100, fullHash: "" },
  ]), /至少需要一条已完成完整 SHA-256/);
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
