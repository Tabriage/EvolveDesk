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
  assert.match(html, /行动 Agent/);
  assert.match(html, /今日唯一焦点/);
  assert.match(html, /我的路线/);
  assert.match(html, /个人业务台/);
  assert.match(html, /创作工作室/);
  assert.match(html, /统一收件箱/);
  assert.match(html, /视频总结/);
  assert.match(html, /知识库/);
  assert.match(html, /周回顾/);
  assert.match(html, /进化实验室/);
  assert.match(html, /工作台数据不会因为一次对话就被悄悄改掉/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("weekly review endpoint refuses to invent a review without recorded evidence", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "weekly-review",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        weeklySnapshot: {
          weekKey: "2026-08-03",
          periodLabel: "8月3日—8月9日",
          sourceStats: {},
          activity: [],
        },
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /没有可回顾/);
});

test("route designer requires a concrete direction before calling a model", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "design-route",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        prompt: "学",
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /至少 4 个字符/);
});

test("business board designer requires a concrete object before calling a model", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "design-board",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        prompt: "记",
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /至少 4 个字符/);
});

test("creator remix refuses to invent a trend without selected evidence", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "creator-ideas",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        mode: "remix",
        prompt: "把今天的热点改成我的内容",
        sources: [],
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /至少需要选择一条真实/);
});

test("content review requires metrics or a real observation before calling a model", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "review-content",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        title: "一次真实发布",
        platform: "B站",
        metrics: {},
        notes: "",
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /至少填写一项真实数据/);
});

test("knowledge Q&A requires selected local evidence before calling a model", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "ask-knowledge",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        question: "这些材料共同说明了什么？",
        knowledge: [],
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /至少选择一张/);
});

test("video summary endpoint refuses to infer from title without transcript evidence", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "summarize-video",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        video: { title: "只有标题的视频" },
        transcript: "内容太短",
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /字幕内容太短/);
});

test("single-video Q&A requires real transcript segments before calling a model", async () => {
  const worker = await createWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "ask-video",
        baseURL: "http://localhost:62783/v1",
        apiKey: "test-key",
        model: "test-model",
        question: "作者给出了哪些步骤？",
        video: { title: "示例视频", url: "local-media://example" },
        segments: [],
      }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /没有可用于回答/);
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
