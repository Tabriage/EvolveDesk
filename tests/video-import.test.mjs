import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVideoUrl,
  validateLocalMediaUpload,
  vttToTranscript,
  WHISPER_MODEL,
  whisperModelIntegrity,
} from "../tools/video-import.mjs";

test("video importer accepts only explicit supported HTTPS hosts", () => {
  assert.equal(parseVideoUrl("https://www.youtube.com/watch?v=abc").platform, "youtube");
  assert.equal(parseVideoUrl("https://www.bilibili.com/video/BV1abc").platform, "bilibili");
  assert.equal(parseVideoUrl("https://xhslink.com/example").platform, "xiaohongshu");
  assert.equal(parseVideoUrl("https://v.douyin.com/example/").platform, "douyin");
  assert.throws(() => parseVideoUrl("http://www.youtube.com/watch?v=abc"), /HTTPS/);
  assert.throws(() => parseVideoUrl("https://youtube.com.evil.example/watch?v=abc"), /当前支持/);
  assert.throws(() => parseVideoUrl("file:///etc/passwd"), /HTTPS/);
});

test("VTT captions become compact timestamped transcript text", () => {
  const transcript = vttToTranscript(`WEBVTT

00:00:01.000 --> 00:00:03.000
<c>第一句话 &amp; 一个概念</c>

00:00:03.000 --> 00:00:05.000
<c>第一句话 &amp; 一个概念</c>

00:01:08.200 --> 00:01:11.000
第二句话
`);
  assert.equal(transcript, "[00:01] 第一句话 & 一个概念\n[01:08] 第二句话");
  assert.doesNotMatch(transcript, /<c>|WEBVTT|-->/);
});

test("local Whisper model requires the pinned size and checksum", () => {
  assert.deepEqual(whisperModelIntegrity(WHISPER_MODEL.bytes, WHISPER_MODEL.sha1), { ready: true, reason: null });
  assert.equal(whisperModelIntegrity(562_000, WHISPER_MODEL.sha1).reason, "size-mismatch");
  assert.equal(whisperModelIntegrity(WHISPER_MODEL.bytes, "0".repeat(40)).reason, "checksum-mismatch");
  assert.match(WHISPER_MODEL.url, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\//);
});

test("local media upload accepts bounded media files and strips path components", () => {
  assert.deepEqual(validateLocalMediaUpload({
    name: encodeURIComponent("../课程复盘.mp4"),
    type: "video/mp4",
    size: 4096,
  }), {
    originalName: "课程复盘.mp4",
    extension: ".mp4",
    declaredSize: 4096,
    mimeType: "video/mp4",
  });
  assert.throws(() => validateLocalMediaUpload({ name: "notes.txt", type: "text/plain", size: 10 }), /请选择/);
  assert.throws(() => validateLocalMediaUpload({ name: "large.mp4", type: "video/mp4", size: 501 * 1024 * 1024 }), /500MB/);
});
