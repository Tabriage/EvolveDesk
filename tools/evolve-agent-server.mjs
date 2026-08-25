import { createServer } from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import { Output, ToolLoopAgent } from "ai";
import { z } from "zod";
import {
  adoptMergedProposal,
  assertEvolutionGitReady,
  commitProposal,
  createProposal,
  discardProposal,
  latestProposal,
  publishProposal,
  refreshProposalReview,
  rollbackProposal,
  sourceContext,
} from "./evolution-core.mjs";
import {
  downloadWhisperModel,
  discardLocalMedia,
  extractLocalVisualEvidence,
  extractVideoVisualEvidence,
  importLocalMedia,
  importVideo,
  transcriptionStatus,
  transcribeLocalMedia,
  transcribeVideo,
} from "./video-import.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.EVOLVE_AGENT_PORT || 4242);
const ALLOWED_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
const MAX_REQUEST_BYTES = 256 * 1024;
let videoImportBusy = false;
let localMediaImportBusy = false;
let modelDownloadBusy = false;
let videoTranscriptionBusy = false;
let visualEvidenceBusy = false;
let sourceEvolutionBusy = false;

const outputSchema = z.object({
  title: z.string().min(2).max(80),
  intent: z.string().min(4).max(240),
  reflection: z.string().min(10).max(420),
  risk: z.enum(["low", "medium", "high"]),
  files: z.array(z.object({
    path: z.string().min(3).max(160),
    reason: z.string().min(3).max(180),
    content: z.string().min(1).max(80_000),
  })).min(1).max(4),
});

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:3000",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-evolve-file-name, x-evolve-file-size, x-evolve-file-type",
    "cache-control": "no-store",
    vary: "origin",
  };
}

function send(response, status, payload, origin = "") {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("请求内容超过本地 Agent 上限");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function validateOrigin(request) {
  const origin = String(request.headers.origin || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) throw new Error("请求来源不在本地工作台白名单中");
  return origin;
}

function validateLocalBaseURL(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("源码 Agent 只允许连接本机 HTTP 模型服务");
  }
  return url.toString().replace(/\/$/, "");
}

async function listModels(baseURL, apiKey) {
  const response = await fetch(`${baseURL}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`模型服务返回 ${response.status}`);
  const payload = await response.json();
  return (payload.data || []).map((item) => item.id).filter(Boolean);
}

async function propose(body) {
  await assertEvolutionGitReady();
  const baseURL = validateLocalBaseURL(body.baseURL);
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) throw new Error("缺少 API 密钥");
  let modelId = String(body.model || "").trim();
  if (!modelId) modelId = (await listModels(baseURL, apiKey))[0] || "";
  if (!modelId) throw new Error("没有发现可用模型");
  const prompt = String(body.prompt || "").trim();
  if (prompt.length < 4 || prompt.length > 2_000) throw new Error("请用 4–2000 个字符描述想要的变化");

  const files = await sourceContext();
  const context = files.map((file) => `--- FILE: ${file.path} ---\n${file.content}\n--- END FILE ---`).join("\n\n");
  const openai = createOpenAI({ apiKey, baseURL, name: "evolve-local-source-agent" });
  const agent = new ToolLoopAgent({
    model: openai.chat(modelId),
    output: Output.object({ schema: outputSchema }),
    instructions: `你是 Evolve Desk 的受限源码进化 Agent。你负责生成可审阅的完整文件替换提案，不执行命令，也不声称已经修改文件。

硬性边界：
- 只能修改 app/page.tsx、app/layout.tsx、app/globals.css、README.md，或 app/components、app/features、tests 下的受支持源码；源码实验室与安全测试本身除外。
- 不得修改 app/api、tools、package.json、锁文件、构建配置、Git、环境变量或任何密钥链路。
- 不得加入外部网络请求、遥测、脚本注入、动态执行、文件系统、终端、Cookie 或隐藏数据通道。
- 保留 Evolve Desk 现有中文产品语言、视觉系统、响应式体验和无障碍行为。
- 产品功能必须形成真实闭环：输入能保存、状态能恢复、动作有反馈；不得用静态卡片或假按钮冒充已经实现的能力。
- 优先复用 app/features/workbench-core.mjs 的任务、收件箱、习惯与活动模型。需要扩展本地数据类型时，同步更新声明文件与 tests 下的状态测试。
- 新能力应从“采集 → 理解/整理 → 行动 → 记忆”中的明确一环接入，保留现有数据的向后兼容读取。
- 每个 files[].content 必须是该文件修改后的完整内容，不能是 diff、代码围栏或省略片段。
- 一次修改 1–4 个文件，改动尽可能小；如果现有文件足够，不要无故新建文件。
- reflection 说明为何这样做、刻意没有做什么，以及回滚为何安全。
- 如果用户要求突破边界，改为给出边界内最接近的安全实现。`,
  });
  const result = await agent.generate({
    prompt: `用户希望工作台发生以下变化：\n${prompt}\n\n这是当前允许观察的源码：\n${context}\n\n请输出一个能直接审阅的最小完整提案。`,
  });
  if (!result.output) throw new Error("模型没有返回结构化源码提案");
  return { proposal: await createProposal(result.output), model: modelId };
}

async function handleSourceEvolution(operation) {
  if (sourceEvolutionBusy) throw new Error("源码实验室正在处理另一项操作，请等待它完成");
  sourceEvolutionBusy = true;
  try {
    return await operation();
  } finally {
    sourceEvolutionBusy = false;
  }
}

async function handleVideoImport(body) {
  if (videoImportBusy) throw new Error("已有一个视频正在导入，请等待它完成");
  videoImportBusy = true;
  try {
    return { video: await importVideo(body.url) };
  } finally {
    videoImportBusy = false;
  }
}

async function handleLocalMediaImport(request) {
  if (localMediaImportBusy) throw new Error("已有一个本地文件正在导入，请等待它完成");
  localMediaImportBusy = true;
  try {
    return {
      video: await importLocalMedia(request, {
        name: request.headers["x-evolve-file-name"],
        type: request.headers["x-evolve-file-type"] || request.headers["content-type"],
        size: request.headers["x-evolve-file-size"],
        contentLength: request.headers["content-length"],
      }),
    };
  } finally {
    localMediaImportBusy = false;
  }
}

async function currentTranscriptionStatus() {
  return {
    ...(await transcriptionStatus()),
    downloading: modelDownloadBusy,
    transcribing: videoTranscriptionBusy,
    extractingVisuals: visualEvidenceBusy,
  };
}

async function handleModelDownload() {
  if (modelDownloadBusy) throw new Error("Whisper 模型正在下载，请等待它完成");
  modelDownloadBusy = true;
  try {
    await downloadWhisperModel();
    modelDownloadBusy = false;
    return { status: await currentTranscriptionStatus() };
  } finally {
    modelDownloadBusy = false;
  }
}

async function handleVideoTranscription(body) {
  if (videoTranscriptionBusy) throw new Error("已有一个视频正在本地转录，请等待它完成");
  videoTranscriptionBusy = true;
  try {
    return { transcription: body.uploadId ? await transcribeLocalMedia(body.uploadId) : await transcribeVideo(body.url) };
  } finally {
    videoTranscriptionBusy = false;
  }
}

async function handleVisualEvidence(body) {
  if (visualEvidenceBusy) throw new Error("已有一个视频正在抽取画面，请等待它完成");
  visualEvidenceBusy = true;
  try {
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 160) : [];
    return {
      visualEvidence: body.uploadId
        ? await extractLocalVisualEvidence(body.uploadId, candidates)
        : await extractVideoVisualEvidence(body.url, candidates),
    };
  } finally {
    visualEvidenceBusy = false;
  }
}

const server = createServer(async (request, response) => {
  let origin = "";
  try {
    origin = validateOrigin(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(origin));
      response.end();
      return;
    }
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, {
        ok: true,
        version: "0.9.0",
        capabilities: ["source-evolution", "isolated-proposal-branches", "github-draft-review", "verified-merge-adoption", "video-import", "local-media-upload", "local-transcription", "visual-evidence", "local-ocr"],
        sourceEvolutionBusy,
        latest: await latestProposal(),
      }, origin);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/video/transcription/status") {
      send(response, 200, { status: await currentTranscriptionStatus() }, origin);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/proposals/latest") {
      send(response, 200, { proposal: await latestProposal() }, origin);
      return;
    }
    if (request.method === "POST") {
      if (url.pathname === "/api/video/upload") {
        send(response, 200, await handleLocalMediaImport(request), origin);
        return;
      }
      const body = await readBody(request);
      if (url.pathname === "/api/propose") {
        send(response, 200, await handleSourceEvolution(() => propose(body)), origin);
        return;
      }
      if (url.pathname === "/api/video/import") {
        send(response, 200, await handleVideoImport(body), origin);
        return;
      }
      if (url.pathname === "/api/video/transcription/model") {
        send(response, 200, await handleModelDownload(), origin);
        return;
      }
      if (url.pathname === "/api/video/transcribe") {
        send(response, 200, await handleVideoTranscription(body), origin);
        return;
      }
      if (url.pathname === "/api/video/visual-evidence") {
        send(response, 200, await handleVisualEvidence(body), origin);
        return;
      }
      if (url.pathname === "/api/video/upload/discard") {
        send(response, 200, { discarded: await discardLocalMedia(body.uploadId) }, origin);
        return;
      }
      if (url.pathname === "/api/commit") {
        send(response, 200, await handleSourceEvolution(async () => ({ proposal: await commitProposal(body.id) })), origin);
        return;
      }
      if (url.pathname === "/api/publish") {
        send(response, 200, await handleSourceEvolution(async () => ({ proposal: await publishProposal(body.id) })), origin);
        return;
      }
      if (url.pathname === "/api/review/refresh") {
        send(response, 200, await handleSourceEvolution(async () => ({ proposal: await refreshProposalReview(body.id) })), origin);
        return;
      }
      if (url.pathname === "/api/adopt") {
        send(response, 200, await handleSourceEvolution(async () => ({ proposal: await adoptMergedProposal(body.id) })), origin);
        return;
      }
      if (url.pathname === "/api/rollback") {
        send(response, 200, await handleSourceEvolution(async () => ({ proposal: await rollbackProposal(body.id) })), origin);
        return;
      }
      if (url.pathname === "/api/discard") {
        send(response, 200, await handleSourceEvolution(async () => ({ proposal: await discardProposal(body.id) })), origin);
        return;
      }
    }
    send(response, 404, { error: "未知的本地 Agent 路径" }, origin);
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : "本地源码 Agent 请求失败" }, origin);
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : PORT;
  console.log(`Evolve source agent ready at http://${HOST}:${actualPort}`);
});
