"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type DiffLine = {
  kind: "context" | "add" | "remove" | "gap";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

type SourceProposal = {
  id: string;
  title: string;
  intent: string;
  reflection: string;
  risk: "low" | "medium" | "high";
  status: "proposed" | "applied" | "rolled_back" | "discarded";
  createdAt: string;
  appliedAt: string | null;
  rolledBackAt: string | null;
  baseSha: string;
  guards: string[];
  validation: null | {
    status: "passed" | "failed";
    summary: string;
    output: string;
  };
  files: Array<{
    path: string;
    reason: string;
    diff: { lines: DiffLine[]; additions: number; deletions: number };
  }>;
};

type EvolutionLabProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  onNeedSettings: () => void;
};

const SOURCE_AGENT_URL = "http://localhost:4242";
const ideas = [
  "让快速捕捉可以真正保存和回看",
  "给专注舱增加一个不打扰的计时器",
  "改善手机上能力花园的阅读体验",
];

async function sourceRequest(path: string, body?: Record<string, unknown>) {
  const response = await fetch(`${SOURCE_AGENT_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as {
    error?: string;
    proposal?: SourceProposal | null;
    latest?: SourceProposal | null;
    model?: string;
  };
  if (!response.ok) throw new Error(data.error || "源码 Agent 没有完成请求");
  return data;
}

export function EvolutionLab({ baseURL, apiKey, model, onNeedSettings }: EvolutionLabProps) {
  const [online, setOnline] = useState(false);
  const [proposal, setProposal] = useState<SourceProposal | null>(null);
  const [activePath, setActivePath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"" | "proposing" | "applying" | "rolling-back" | "discarding">("");
  const [message, setMessage] = useState("正在确认本地源码沙箱…");

  useEffect(() => {
    let active = true;
    sourceRequest("/health")
      .then((data) => {
        if (!active) return;
        setOnline(true);
        if (data.latest) {
          setProposal(data.latest);
          setActivePath(data.latest.files[0]?.path || "");
        }
        setMessage("源码沙箱在线，等待你的要求");
      })
      .catch(() => {
        if (!active) return;
        setOnline(false);
        setMessage("源码沙箱未启动，请使用 pnpm dev 启动完整工作台");
      });
    return () => {
      active = false;
    };
  }, []);

  const activeFile = proposal?.files.find((file) => file.path === activePath) || proposal?.files[0];
  const totals = useMemo(
    () => proposal?.files.reduce(
      (result, file) => ({
        additions: result.additions + file.diff.additions,
        deletions: result.deletions + file.diff.deletions,
      }),
      { additions: 0, deletions: 0 },
    ) || { additions: 0, deletions: 0 },
    [proposal],
  );

  async function requestProposal(event: FormEvent) {
    event.preventDefault();
    const request = prompt.trim();
    if (!request) return;
    if (!apiKey.trim()) {
      setMessage("先在连接设置中输入模型密钥");
      onNeedSettings();
      return;
    }
    if (!online) {
      setMessage("源码沙箱未连接，无法生成代码提案");
      return;
    }
    setBusy("proposing");
    setMessage("Agent 正在阅读允许的源码，并封装一份可回滚提案…");
    try {
      const data = await sourceRequest("/api/propose", {
        prompt: request,
        baseURL,
        apiKey,
        model,
      });
      if (!data.proposal) throw new Error("Agent 没有返回源码提案");
      setProposal(data.proposal);
      setActivePath(data.proposal.files[0]?.path || "");
      setPrompt("");
      setMessage("提案已封存。请逐文件检查后决定是否写入");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "源码提案生成失败");
    } finally {
      setBusy("");
    }
  }

  async function mutate(action: "apply" | "rollback" | "discard") {
    if (!proposal) return;
    const state = action === "apply" ? "applying" : action === "rollback" ? "rolling-back" : "discarding";
    setBusy(state);
    setMessage(
      action === "apply"
        ? "正在校验文件指纹、写入变更并运行固定测试…"
        : action === "rollback"
          ? "正在核对变更指纹并恢复提案前内容…"
          : "正在搁置提案…",
    );
    try {
      const data = await sourceRequest(`/api/${action}`, { id: proposal.id });
      if (!data.proposal) throw new Error("源码沙箱没有返回结果");
      setProposal(data.proposal);
      setMessage(
        action === "apply"
          ? data.proposal.validation?.summary || "变更已写入工作区"
          : action === "rollback"
            ? "已恢复提案前的全部文件"
            : "提案已搁置，没有改动源码",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "源码操作失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="evolution-lab">
      <div className="lab-hero">
        <div>
          <p className="eyebrow">Source evolution · 本机限定</p>
          <h1>让工作台改写自己，<br /><em>但每一笔都经过你。</em></h1>
          <p className="lab-lede">Agent 只在一小块源码花园里工作。它能观察、提案和写入，却无法碰触密钥、终端、构建配置或自己的安全边界。</p>
        </div>
        <div className={`lab-seal ${online ? "online" : ""}`}>
          <span>✦</span>
          <strong>{online ? "沙箱已密封" : "沙箱离线"}</strong>
          <small>{online ? "127.0.0.1 · 4 道门" : "等待本地服务"}</small>
        </div>
      </div>

      <div className="evolution-route" aria-label="源码变更流程">
        <div className="route-node done"><i>1</i><span><strong>观察</strong><small>只读白名单源码</small></span></div>
        <div className={`route-line ${proposal ? "filled" : ""}`} />
        <div className={`route-node ${proposal ? "done" : ""}`}><i>2</i><span><strong>封装</strong><small>差异与风险检查</small></span></div>
        <div className={`route-line ${proposal?.status === "applied" ? "filled" : ""}`} />
        <div className={`route-node ${proposal?.status === "applied" ? "done" : ""}`}><i>3</i><span><strong>确认</strong><small>写入并固定验证</small></span></div>
      </div>

      <form className="evolution-composer" onSubmit={requestProposal}>
        <div>
          <label htmlFor="evolution-request">这次想让工作台学会什么？</label>
          <textarea
            id="evolution-request"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：让快速捕捉可以保存，并在刷新后继续看到…"
          />
          <div className="lab-ideas">
            {ideas.map((idea) => <button type="button" key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}
          </div>
        </div>
        <button className="seal-button" disabled={Boolean(busy) || !prompt.trim()}>
          {busy === "proposing" ? "正在封装" : "生成源码提案"}<span>↗</span>
        </button>
      </form>

      {!proposal ? (
        <div className="lab-empty">
          <div className="empty-envelope"><i /><i /><span>等待要求</span></div>
          <div><strong>这里会出现一只“变更信封”</strong><p>里面包含每个文件的增删行、设计自省、安全检查和回滚基线。打开检查之前，源码不会改变。</p></div>
        </div>
      ) : (
        <article className="source-proposal">
          <header className="source-proposal-head">
            <div>
              <div className="proposal-meta"><span>源码提案 · {proposal.id.slice(0, 8)}</span><i className={`risk ${proposal.risk}`}>{proposal.risk === "low" ? "低风险" : proposal.risk === "medium" ? "中风险" : "高风险"}</i></div>
              <h2>{proposal.title}</h2>
              <p>{proposal.intent}</p>
            </div>
            <div className={`proposal-status ${proposal.status}`}>
              <i />
              {proposal.status === "proposed" ? "待确认" : proposal.status === "applied" ? "已写入" : proposal.status === "rolled_back" ? "已回滚" : "已搁置"}
            </div>
          </header>

          <div className="source-summary">
            <span><strong>{proposal.files.length}</strong> 个文件</span>
            <span className="add"><strong>+{totals.additions}</strong> 新增</span>
            <span className="remove"><strong>−{totals.deletions}</strong> 删除</span>
            <span><strong>{proposal.baseSha.slice(0, 7)}</strong> Git 基线</span>
          </div>

          <div className="guard-strip">
            {proposal.guards.map((guard) => <span key={guard}><i>✓</i>{guard}</span>)}
          </div>

          <div className="file-review">
            <nav aria-label="变更文件">
              {proposal.files.map((file) => (
                <button
                  key={file.path}
                  className={activeFile?.path === file.path ? "active" : ""}
                  onClick={() => setActivePath(file.path)}
                >
                  <span>{file.path.split("/").pop()}</span>
                  <small><b>+{file.diff.additions}</b> −{file.diff.deletions}</small>
                </button>
              ))}
            </nav>
            {activeFile && (
              <section className="diff-sheet">
                <header><code>{activeFile.path}</code><p>{activeFile.reason}</p></header>
                <div className="diff-lines" role="table" aria-label={`${activeFile.path} 的代码差异`}>
                  {activeFile.diff.lines.map((line, index) => (
                    <div className={`diff-line ${line.kind}`} role="row" key={`${index}-${line.kind}`}>
                      <span>{line.oldLine ?? ""}</span>
                      <span>{line.newLine ?? ""}</span>
                      <code>{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "} {line.text}</code>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="proposal-reflection">
            <span>✦ 设计自省</span>
            <p>{proposal.reflection}</p>
          </div>

          {proposal.validation && (
            <details className={`validation-result ${proposal.validation.status}`} open={proposal.validation.status === "failed"}>
              <summary><span>{proposal.validation.status === "passed" ? "✓" : "!"}</span>{proposal.validation.summary}</summary>
              <pre>{proposal.validation.output}</pre>
            </details>
          )}

          <footer className="source-actions">
            <p><i />{message}</p>
            <div>
              {proposal.status === "proposed" && <button className="ghost" disabled={Boolean(busy)} onClick={() => void mutate("discard")}>搁置提案</button>}
              {proposal.status === "proposed" && <button className="approve" disabled={Boolean(busy)} onClick={() => void mutate("apply")}>{busy === "applying" ? "正在写入与验证…" : "确认写入源码"}<span>↗</span></button>}
              {proposal.status === "applied" && <button className="rollback-button" disabled={Boolean(busy)} onClick={() => void mutate("rollback")}>{busy === "rolling-back" ? "正在恢复…" : "回滚这次变化"}</button>}
            </div>
          </footer>
        </article>
      )}

      <p className="lab-status"><i className={online ? "online" : ""} />{message}</p>
    </section>
  );
}
