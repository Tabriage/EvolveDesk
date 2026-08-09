import assert from "node:assert/strict";
import test from "node:test";
import {
  searchTranscript,
  segmentTranscript,
  selectTranscriptEvidence,
  timestampToSeconds,
  videoTimestampUrl,
} from "../app/features/transcript-core.mjs";

test("timestamped transcript becomes bounded navigable evidence", () => {
  const transcript = [
    "[00:01] 开头介绍本期目标。",
    `[01:20] ${"中段解释证据核对流程。".repeat(90)}`,
    "[03:05] 最后给出三个行动步骤。",
  ].join("\n");
  const segments = segmentTranscript(transcript);
  assert.ok(segments.length >= 2);
  assert.equal(segments[0].seconds, 1);
  assert.equal(timestampToSeconds("1:02:03"), 3723);
  assert.equal(timestampToSeconds("61:03"), null);
  assert.ok(segments.every((segment) => segment.text.length <= 1440));
});

test("transcript search and question evidence prefer matching text while retaining context", () => {
  const transcript = [
    "[00:01] 先说明研究问题和资料范围。",
    `[00:40] ${"这里解释证据核对与来源引用。".repeat(70)}`,
    "[03:20] 最后把结论转成可以执行的任务。",
  ].join("\n");
  const matches = searchTranscript(transcript, "证据核对", 4);
  assert.ok(matches.length >= 1);
  assert.match(matches[0].text, /证据核对/);
  const evidence = selectTranscriptEvidence(transcript, "怎样核对证据？", 6, 5000);
  assert.ok(evidence.some((segment) => /证据核对/.test(segment.text)));
  assert.ok(evidence.some((segment) => /研究问题/.test(segment.text)));
});

test("timestamp links are added only for supported web URLs", () => {
  assert.match(videoTimestampUrl("https://www.youtube.com/watch?v=abc", 83), /t=83/);
  assert.equal(videoTimestampUrl("local-media://example", 83), "local-media://example");
});
