import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

async function startServer() {
  const child = spawn(process.execPath, ["tools/evolve-agent-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, EVOLVE_AGENT_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("source agent did not start")), 8_000);
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
  return { child, port };
}

test("local source agent exposes health and rejects foreign origins", async (context) => {
  const { child, port } = await startServer();
  context.after(() => child.kill("SIGTERM"));

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  const healthPayload = await health.json();
  assert.equal(healthPayload.ok, true);
  assert.ok(healthPayload.capabilities.includes("video-import"));
  assert.ok(healthPayload.capabilities.includes("local-transcription"));
  assert.ok(healthPayload.capabilities.includes("local-media-upload"));

  const transcriptionStatus = await fetch(`http://127.0.0.1:${port}/api/video/transcription/status`, {
    headers: { origin: "http://localhost:3000" },
  });
  assert.equal(transcriptionStatus.status, 200);
  const transcriptionPayload = await transcriptionStatus.json();
  assert.equal(typeof transcriptionPayload.status.runtime.ready, "boolean");
  assert.equal(typeof transcriptionPayload.status.runtime.localReady, "boolean");
  assert.equal(typeof transcriptionPayload.status.model.ready, "boolean");
  assert.equal(transcriptionPayload.status.downloading, false);

  const blocked = await fetch(`http://127.0.0.1:${port}/api/apply`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify({ id: "not-a-proposal" }),
  });
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /请求来源/);

  const unsafeVideo = await fetch(`http://127.0.0.1:${port}/api/video/import`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ url: "https://youtube.com.evil.example/watch?v=test" }),
  });
  assert.equal(unsafeVideo.status, 400);
  assert.match((await unsafeVideo.json()).error, /当前支持/);

  const unsafeTranscription = await fetch(`http://127.0.0.1:${port}/api/video/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ url: "https://youtube.com.evil.example/watch?v=test" }),
  });
  assert.equal(unsafeTranscription.status, 400);
  assert.match((await unsafeTranscription.json()).error, /当前支持/);

  const unsafeUpload = await fetch(`http://127.0.0.1:${port}/api/video/upload`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "text/plain",
      "x-evolve-file-name": "notes.txt",
      "x-evolve-file-size": "8",
    },
    body: "not media",
  });
  assert.equal(unsafeUpload.status, 400);
  assert.match((await unsafeUpload.json()).error, /请选择/);
});
