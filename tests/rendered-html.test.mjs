import assert from "node:assert/strict";
import test from "node:test";

async function createWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the Evolve Desk product", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    env,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Evolve Desk · 会生长的个人工作台<\/title>/i);
  assert.match(html, /Evolve Desk/);
  assert.match(html, /内生 Agent/);
  assert.match(html, /未经确认，我不会动任何东西/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("agent endpoint rejects non-local model hosts", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "models",
        baseURL: "https://example.com/v1",
        apiKey: "test-key",
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.match(payload.error, /只允许本机 HTTP 模型服务/);
});
