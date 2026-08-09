import assert from "node:assert/strict";
import test from "node:test";
import { imageSize } from "image-size";

test("local image dimension reader handles a normal PNG", () => {
  const png = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 2, 0, 0, 0, 3,
  ]);
  assert.deepEqual(imageSize(png), { width: 2, height: 3, type: "png" });
});

test("local image dimension reader rejects malformed container formats without looping", () => {
  const icnsWithZeroEntry = Uint8Array.from([
    105, 99, 110, 115, 0, 0, 0, 16,
    105, 99, 48, 55, 0, 0, 0, 0,
  ]);
  const jxlWithZeroBox = Uint8Array.from([
    0, 0, 0, 0, 74, 88, 76, 32,
    0, 0, 0, 0, 106, 120, 108, 112,
  ]);
  const heifWithZeroBox = Uint8Array.from([
    0, 0, 0, 0, 102, 116, 121, 112,
    104, 101, 105, 99, 0, 0, 0, 0,
  ]);

  assert.throws(() => imageSize(icnsWithZeroEntry), /unsupported/);
  assert.throws(() => imageSize(jxlWithZeroBox), /unsupported/);
  assert.throws(() => imageSize(heifWithZeroBox), /unsupported/);
});
