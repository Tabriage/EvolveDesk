"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Module = {
  id: string;
  name: string;
  description: string;
  accent: string;
  enabled: boolean;
  source?: "core" | "agent";
};

type Proposal = {
  title: string;
  summary: string;
  reflection: string;
  risk: "low" | "medium" | "high";
  changes: string[];
  rollback: string;
  module: { name: string; description: string; accent: string };
};

const initialModules: Module[] = [
  {
    id: "focus",
    name: "专注舱",
    description: "把今天唯一重要的事固定在视野中央。",
    accent: "#3159f5",
    enabled: true,
    source: "core",
  },
  {
    id: "capture",
    name: "灵感收件箱",
    description: "不分类，先接住刚刚冒出来的念头。",
    accent: "#ff6d5a",
    enabled: true,
    source: "core",
  },
  {
    id: "signals",
    name: "信号观察",
    description: "把值得持续留意的人、项目和变化放在一起。",
    accent: "#e5a62a",
    enabled: false,
    source: "core",
  },
];

const seedProposal: Proposal = {
  title: "给工作台增加「夜间收束」",
  summary: "每天结束时，用三个问题生成一张可回看的日结卡。",
  reflection:
    "当前工作台擅长开始任务，但缺少结束一天的仪式。新模块应该轻量，不应变成另一套待办系统。",
  risk: "low",
  changes: ["新增日结入口", "保存三条本地回答", "次日首页展示一句回声"],
  rollback: "移除模块并清空它在此浏览器中的本地记录。",
  module: {
    name: "夜间收束",
    description: "用三个问题结束今天，给明天留下一句回声。",
    accent: "#7657d6",
  },
};

const prompts = [
  "帮我增加一个每周复盘模块",
  "观察现在的工作台，找出一个最值得改进的地方",
  "设计一个不会让我焦虑的任务入口",
];

export default function Home() {
  const [modules, setModules] = useState<Module[]>(initialModules);
  const [proposal, setProposal] = useState<Proposal>(seedProposal);
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState("等待你的确认");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseURL, setBaseURL] = useState("http://localhost:62783/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [activeView, setActiveView] = useState<"canvas" | "memory">("canvas");

  useEffect(() => {
    const savedModules = window.localStorage.getItem("evolve-desk.modules");
    const savedSettings = window.localStorage.getItem("evolve-desk.connection");
    const frame = window.requestAnimationFrame(() => {
      if (savedModules) {
        try {
          setModules(JSON.parse(savedModules));
        } catch {
          window.localStorage.removeItem("evolve-desk.modules");
        }
      }
      if (savedSettings) {
        try {
          const settings = JSON.parse(savedSettings);
          setBaseURL(settings.baseURL || "http://localhost:62783/v1");
          setModel(settings.model || "");
        } catch {
          window.localStorage.removeItem("evolve-desk.connection");
        }
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("evolve-desk.modules", JSON.stringify(modules));
  }, [modules]);

  const enabledCount = useMemo(
    () => modules.filter((item) => item.enabled).length,
    [modules],
  );

  function toggleModule(id: string) {
    setModules((current) =>
      current.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item,
      ),
    );
  }

  async function connect() {
    if (!apiKey.trim()) {
      setNotice("请先输入密钥；它只保留在当前页面内存中");
      return;
    }
    setNotice("正在询问本地模型…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "models", baseURL, apiKey }),
      });
      const data = (await response.json()) as { error?: string; models: string[] };
      if (!response.ok) throw new Error(data.error || "连接失败");
      setModels(data.models);
      const selected = model || data.models[0] || "";
      setModel(selected);
      setConnected(true);
      setNotice(`已连接 · ${data.models.length} 个模型可用`);
      window.localStorage.setItem(
        "evolve-desk.connection",
        JSON.stringify({ baseURL, model: selected }),
      );
    } catch (error) {
      setConnected(false);
      setNotice(error instanceof Error ? error.message : "无法连接本地模型");
    }
  }

  async function askAgent(event: FormEvent) {
    event.preventDefault();
    const request = prompt.trim();
    if (!request) return;
    if (!apiKey.trim()) {
      setSettingsOpen(true);
      setNotice("先在连接设置中输入密钥");
      return;
    }
    setThinking(true);
    setNotice("Agent 正在观察、设计和自检…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          baseURL,
          apiKey,
          model,
          prompt: request,
          modules: modules.map(({ name, description, enabled }) => ({
            name,
            description,
            enabled,
          })),
        }),
      });
      const data = (await response.json()) as { error?: string; proposal: Proposal; model?: string };
      if (!response.ok) throw new Error(data.error || "Agent 没有返回提案");
      setProposal(data.proposal);
      setModel(data.model || model);
      setPrompt("");
      setNotice("新提案已就绪，等待你的确认");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Agent 暂时不可用");
    } finally {
      setThinking(false);
    }
  }

  function applyProposal() {
    const newModule: Module = {
      id: `agent-${Date.now()}`,
      ...proposal.module,
      enabled: true,
      source: "agent",
    };
    setModules((current) => [...current, newModule]);
    setNotice(`已加入「${newModule.name}」，可随时停用或移除`);
  }

  function dismissProposal() {
    setNotice("已搁置提案，没有改变工作台");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setActiveView("canvas")}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>Evolve Desk</strong>
            <small>会和你一起长大的工作台</small>
          </span>
        </button>
        <div className="top-actions">
          <span className={`connection ${connected ? "is-online" : ""}`}>
            <i /> {connected ? "本地模型在线" : "尚未连接模型"}
          </span>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="打开连接设置">
            ⌘
          </button>
          <div className="avatar">岚</div>
        </div>
      </header>

      <aside className="rail" aria-label="工作台导航">
        <button
          className={activeView === "canvas" ? "active" : ""}
          onClick={() => setActiveView("canvas")}
        >
          <span>◫</span> 生长画布
        </button>
        <button
          className={activeView === "memory" ? "active" : ""}
          onClick={() => setActiveView("memory")}
        >
          <span>◎</span> 自省记忆
        </button>
        <div className="rail-label">能力模块</div>
        {modules.map((item) => (
          <button key={item.id} onClick={() => toggleModule(item.id)}>
            <i className="module-dot" style={{ background: item.accent }} />
            {item.name}
            <small>{item.enabled ? "开" : "关"}</small>
          </button>
        ))}
        <div className="rail-footer">
          <span>{enabledCount}</span>
          <p>个能力正在陪你工作</p>
        </div>
      </aside>

      <section className="workspace">
        {activeView === "canvas" ? (
          <>
            <div className="workspace-heading">
              <div>
                <p className="eyebrow">今天 · 2026.08.05</p>
                <h1>工作台不必完成，<em>它只需要继续生长。</em></h1>
              </div>
              <div className="growth-index">
                <span>生长指数</span>
                <strong>{Math.min(96, 48 + modules.length * 7)}</strong>
                <small>比上周更贴近你</small>
              </div>
            </div>

            <div className="canvas-grid">
              <article className="focus-card">
                <div className="card-label"><span /> 今日锚点</div>
                <h2>把个人工作台<br />变成长期伙伴</h2>
                <p>第一步：让 Agent 提出的每次改变都有理由、有边界、可撤销。</p>
                <div className="focus-progress"><i /></div>
                <footer><span>1 / 3 个里程碑</span><button>继续推进 →</button></footer>
              </article>

              <article className="capture-card">
                <div className="card-label">快速捕捉</div>
                <textarea aria-label="记录灵感" placeholder="刚刚想到什么？先放在这里…" />
                <footer><span>⌘ + Enter 保存</span><button>收下</button></footer>
              </article>

              <article className="pulse-card">
                <div className="pulse-orbit" aria-hidden="true">
                  <i /><i /><span>3</span>
                </div>
                <div>
                  <div className="card-label">工作台脉搏</div>
                  <h3>{enabledCount} 个能力活跃</h3>
                  <p>最近一次进化发生在今天</p>
                </div>
              </article>

              <article className="modules-card">
                <header>
                  <div><div className="card-label">能力花园</div><h3>你的工作方式</h3></div>
                  <span>{modules.length} 个模块</span>
                </header>
                <div className="module-list">
                  {modules.slice(-4).map((item) => (
                    <div className="module-row" key={item.id}>
                      <i style={{ background: item.accent }}>{item.source === "agent" ? "✦" : ""}</i>
                      <div><strong>{item.name}</strong><p>{item.description}</p></div>
                      <button
                        className={`switch ${item.enabled ? "on" : ""}`}
                        onClick={() => toggleModule(item.id)}
                        aria-label={`${item.enabled ? "停用" : "启用"}${item.name}`}
                      ><span /></button>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </>
        ) : (
          <section className="memory-view">
            <p className="eyebrow">自省记忆 · 只保存在这台设备</p>
            <h1>工作台为什么<br /><em>成为现在的样子？</em></h1>
            <div className="memory-line">
              <time>今天</time>
              <article><strong>{proposal.title}</strong><p>{proposal.reflection}</p><span>来自 Agent 的设计判断</span></article>
            </div>
            <div className="memory-line muted">
              <time>起点</time>
              <article><strong>确立安全边界</strong><p>能力可以生长，但所有改变都必须由人确认，并且可以撤销。</p><span>核心原则</span></article>
            </div>
          </section>
        )}
      </section>

      <aside className="agent-panel">
        <header>
          <div className="agent-glyph"><span>✦</span></div>
          <div><strong>内生 Agent</strong><small>{thinking ? "正在思考" : "可配置 · 可审阅"}</small></div>
          <button aria-label="打开连接设置" onClick={() => setSettingsOpen(true)}>•••</button>
        </header>

        <div className="agent-intro">
          <p>我会观察你的工作方式，提出具体改变。<br />未经确认，我不会动任何东西。</p>
        </div>

        <div className="proposal">
          <div className="proposal-meta">
            <span>变更提案</span>
            <i className={`risk ${proposal.risk}`}>{proposal.risk === "low" ? "低风险" : proposal.risk === "medium" ? "中风险" : "高风险"}</i>
          </div>
          <h3>{proposal.title}</h3>
          <p>{proposal.summary}</p>
          <div className="reflection">
            <span>✦ 自省</span>
            <p>{proposal.reflection}</p>
          </div>
          <div className="change-list">
            {proposal.changes.map((change) => <span key={change}>+ {change}</span>)}
          </div>
          <details>
            <summary>回滚方式</summary>
            <p>{proposal.rollback}</p>
          </details>
          <div className="proposal-actions">
            <button className="ghost" onClick={dismissProposal}>先不改变</button>
            <button className="approve" onClick={applyProposal}>确认加入 <span>↗</span></button>
          </div>
        </div>

        <div className="agent-composer">
          <div className="suggestions">
            {prompts.map((item) => <button key={item} onClick={() => setPrompt(item)}>{item}</button>)}
          </div>
          <form onSubmit={askAgent}>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="告诉 Agent，你想让工作台学会什么…"
              aria-label="给 Agent 的要求"
            />
            <button disabled={thinking || !prompt.trim()} aria-label="发送给 Agent">↑</button>
          </form>
          <p className="status-line"><i />{notice}</p>
        </div>
      </aside>

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">×</button>
            <p className="eyebrow">本地连接</p>
            <h2 id="settings-title">把 Agent 接到你的模型</h2>
            <p className="modal-copy">密钥只停留在当前页面内存，不会写入代码或浏览器存储。刷新页面后需要重新输入。</p>
            <label>Base URL<input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} /></label>
            <label>API 密钥<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入本地服务密钥" autoComplete="off" /></label>
            <label>模型
              {models.length ? (
                <select value={model} onChange={(event) => setModel(event.target.value)}>{models.map((item) => <option key={item}>{item}</option>)}</select>
              ) : (
                <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="连接后自动发现，也可手动填写" />
              )}
            </label>
            <div className="settings-note"><span>安全边界</span><p>第一版只允许连接 localhost / 127.0.0.1；Agent 只能生成模块提案，不能执行终端命令。</p></div>
            <button className="connect-button" onClick={connect}>{connected ? "重新检查连接" : "检查连接"}</button>
          </section>
        </div>
      )}
    </main>
  );
}
