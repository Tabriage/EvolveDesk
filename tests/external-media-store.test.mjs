import assert from "node:assert/strict";
import test from "node:test";
import { createExternalMediaFingerprint, createExternalMediaRecord, verifyExternalMediaFile } from "../app/features/external-media-store.mjs";

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
