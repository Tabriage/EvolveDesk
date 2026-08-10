import assert from "node:assert/strict";
import test from "node:test";
import {
  searchTranscript,
  segmentTranscript,
  selectTranscriptEvidence,
  selectVisualEvidence,
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

test("visual evidence selection prefers matching OCR and keeps structural coverage", () => {
  const frames = [
    { id: "f1", seconds: 10, ocrText: "首页", modelText: "", observation: "打开应用首页", uncertainty: "" },
    { id: "f2", seconds: 40, ocrText: "导出设置", modelText: "PNG", observation: "画面显示导出格式选择", uncertainty: "按钮下半部被遮挡" },
    { id: "f3", seconds: 90, ocrText: "完成", modelText: "", observation: "显示保存成功", uncertainty: "" },
  ];
  const matched = selectVisualEvidence(frames, "如何选择导出格式？", 2);
  assert.equal(matched[0].id, "f2");
  assert.equal(matched.length, 2);
  const structural = selectVisualEvidence(frames, "没有匹配的术语", 3);
  assert.deepEqual(structural.map((frame) => frame.id), ["f1", "f2", "f3"]);
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
