import { createOpenAI } from "@ai-sdk/openai";
import { Output, ToolLoopAgent } from "ai";
import { z } from "zod";

export const runtime = "edge";

const proposalSchema = z.object({
  title: z.string().min(2).max(50),
  summary: z.string().min(4).max(120),
  reflection: z.string().min(10).max(260),
  risk: z.enum(["low", "medium", "high"]),
  changes: z.array(z.string().min(2).max(60)).min(2).max(5),
  rollback: z.string().min(4).max(120),
  module: z.object({
    name: z.string().min(2).max(16),
    description: z.string().min(4).max(60),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
});

function validateLocalBaseURL(value: unknown) {
  const url = new URL(String(value || ""));
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
    throw new Error("为避免请求被转发到未知地址，当前只允许本机 HTTP 模型服务");
  }
  return url.toString().replace(/\/$/, "");
}

async function listModels(baseURL: string, apiKey: string) {
  const response = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`模型服务返回 ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  return (payload.data || []).map((item) => item.id).filter((id): id is string => Boolean(id));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const baseURL = validateLocalBaseURL(body.baseURL);
    const apiKey = String(body.apiKey || "").trim();
    if (!apiKey) return Response.json({ error: "缺少 API 密钥" }, { status: 400 });

    if (body.action === "models") {
      const models = await listModels(baseURL, apiKey);
      return Response.json({ models });
    }

    if (body.action !== "propose") {
      return Response.json({ error: "未知的 Agent 动作" }, { status: 400 });
    }

    let modelId = String(body.model || "").trim();
    if (!modelId) {
      const available = await listModels(baseURL, apiKey);
      modelId = available[0] || "";
    }
    if (!modelId) return Response.json({ error: "没有发现可用模型" }, { status: 400 });

    const openai = createOpenAI({ apiKey, baseURL, name: "local-workbench" });
    const agent = new ToolLoopAgent({
      model: openai.chat(modelId),
      output: Output.object({ schema: proposalSchema }),
      instructions: `你是 Evolve Desk 内部的产品设计与编程 Agent。你的任务不是聊天，而是为个人工作台提出一个小而完整、配置驱动、可撤销的能力模块。

安全边界：
- 只提出变更，不声称已经修改文件或执行命令。
- 不提出读取隐私、获取更高权限、后台联网或隐藏行为。
- 一次只设计一个模块，优先低风险、日常可用、能被关闭的改进。
- 自省必须解释为什么值得做、为什么没有做得更复杂。
- 所有面向用户的文字使用简洁自然的中文。
- accent 必须是清晰的六位十六进制颜色。`,
    });

    const result = await agent.generate({
      prompt: `用户想要：${String(body.prompt || "")}\n\n当前模块：${JSON.stringify(body.modules || [])}\n\n请给出一个可以先审阅再加入工作台的具体提案。`,
    });

    return Response.json({ proposal: result.output, model: modelId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "本地 Agent 请求失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
