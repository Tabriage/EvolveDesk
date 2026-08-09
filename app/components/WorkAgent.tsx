"use client";

import { FormEvent, useState } from "react";
import type { AgentAction, WorkbenchState } from "../features/workbench-core.mjs";

type WorkPlan = {
  title: string;
  summary: string;
  reflection: string;
  risk: "low" | "medium" | "high";
  actions: AgentAction[];
};

type WorkAgentProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  connected: boolean;
  state: WorkbenchState;
  onNeedSettings: () => void;
  onApply: (plan: WorkPlan) => void;
};

const suggestions = [
  "把收件箱里的内容整理成今天三件事",
  "帮我选出今天唯一的焦点",
  "从我的个人路线里挑一个当前动作",
  "为学习和输出设计两个轻量习惯",
];

function actionLabel(action: AgentAction) {
  if (action.type === "add_task") return `新增任务 · ${action.title}`;
  if (action.type === "set_focus") return `设为焦点 · ${action.title}`;
  if (action.type === "add_habit") return `新增习惯 · ${action.name}`;
  if (action.type === "activate_route_action") return "接入个人路线中的一个动作";
  return `保存到收件箱 · ${action.content}`;
}

export function WorkAgent({
  baseURL,
  apiKey,
  model,
  connected,
  state,
  onNeedSettings,
  onApply,
}: WorkAgentProps) {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("说出结果，我先拟动作清单");

  async function requestPlan(event: FormEvent) {
    event.preventDefault();
    const request = prompt.trim();
    if (!request) return;
    if (!apiKey.trim()) {
      setMessage("先连接本地模型，密钥不会写入浏览器存储");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setMessage("Agent 正在阅读今天的任务与收件箱…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "plan",
          baseURL,
          apiKey,
          model,
          prompt: request,
          workspace: {
            focusTaskId: state.focusTaskId,
            tasks: state.tasks.slice(-24),
            inbox: state.inbox.filter((item) => item.status === "new").slice(-18),
            habits: state.habits,
            routes: state.routes.filter((route) => !route.archivedAt).slice(-8).map((route) => {
              const phase = route.phases.find((item) => !item.completedAt);
              return {
                routeId: route.id,
                name: route.name,
                purpose: route.purpose,
                currentPhase: phase ? {
                  phaseId: phase.id,
                  title: phase.title,
                  actions: phase.actions.filter((action) => !action.linkedTaskId && !action.linkedHabitId).map((action) => ({
                    actionId: action.id,
                    title: action.title,
                    mode: action.mode,
                  })),
                } : null,
              };
            }),
          },
        }),
      });
      const data = (await response.json()) as { error?: string; plan?: WorkPlan };
      if (!response.ok || !data.plan) throw new Error(data.error || "Agent 没有返回动作清单");
      setPlan(data.plan);
      setPrompt("");
      setMessage("动作清单已就绪，确认前不会改变任何数据");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent 暂时不可用");
    } finally {
      setBusy(false);
    }
  }

  function applyPlan() {
    if (!plan) return;
    onApply(plan);
    setMessage(`已执行「${plan.title}」，所有数据仍只在此浏览器`);
    setPlan(null);
  }

  return (
    <aside className="agent-panel work-agent-panel">
      <header>
        <div className="agent-glyph"><span>✦</span></div>
        <div>
          <strong>行动 Agent</strong>
          <small>{busy ? "正在整理" : connected ? "本地模型在线" : "等待模型连接"}</small>
        </div>
        <button aria-label="打开连接设置" onClick={onNeedSettings}>•••</button>
      </header>

      <div className="work-agent-intro">
        <span>先计划，后执行</span>
        <h3>告诉我你想得到什么，<br />我把它变成工作台动作。</h3>
        <p>我可以新增任务、选择焦点、保存材料、建立习惯，也能把个人路线的当前动作接进今天。每次都先给你看清单。</p>
      </div>

      {plan ? (
        <article className="work-plan-card">
          <div className="proposal-meta">
            <span>待确认动作</span>
            <i className={`risk ${plan.risk}`}>{plan.risk === "low" ? "低风险" : plan.risk === "medium" ? "中风险" : "高风险"}</i>
          </div>
          <h3>{plan.title}</h3>
          <p>{plan.summary}</p>
          <div className="work-plan-actions">
            {plan.actions.map((action, index) => (
              <div key={`${action.type}-${index}`}><i>{index + 1}</i><span>{actionLabel(action)}</span></div>
            ))}
          </div>
          <div className="reflection"><span>✦ 自省</span><p>{plan.reflection}</p></div>
          <div className="proposal-actions">
            <button className="ghost" onClick={() => { setPlan(null); setMessage("已搁置，没有改变工作台"); }}>先不执行</button>
            <button className="approve" onClick={applyPlan}>确认执行 <span>↗</span></button>
          </div>
        </article>
      ) : (
        <div className="agent-empty-state">
          <div className="agent-empty-orbit"><i /><i /><span>0</span></div>
          <strong>当前没有待确认动作</strong>
          <p>工作台数据不会因为一次对话就被悄悄改掉。</p>
        </div>
      )}

      <div className="agent-composer">
        <div className="suggestions">
          {suggestions.map((item) => <button key={item} onClick={() => setPrompt(item)}>{item}</button>)}
        </div>
        <form onSubmit={requestPlan}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：把刚收下的三个链接安排到本周…"
            aria-label="给行动 Agent 的要求"
          />
          <button disabled={busy || !prompt.trim()} aria-label="发送给行动 Agent">↑</button>
        </form>
        <p className="status-line"><i />{message}</p>
      </div>
    </aside>
  );
}
