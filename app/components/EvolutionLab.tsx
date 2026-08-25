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
  status: "proposed" | "committed" | "published" | "adopted" | "applied" | "rolled_back" | "discarded";
  createdAt: string;
  appliedAt: string | null;
  adoptedAt: string | null;
  rolledBackAt: string | null;
  baseSha: string;
  baseBranch: string;
  remoteRepository: string;
  guards: string[];
  validation: null | {
    status: "passed" | "failed";
    summary: string;
    output: string;
  };
  branch: null | {
    name: string;
    commitSha: string;
    baseBranch: string;
    committedAt: string;
  };
  remoteReview: null | {
    status: "pushed" | "draft" | "open" | "closed" | "merged";
    url: string;
    headSha: string;
    inSync: boolean;
    baseBranch?: string;
    mergeCommitSha?: string;
    publishedAt: string;
    checkedAt: string;
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
  const [busy, setBusy] = useState<"" | "proposing" | "committing" | "publishing" | "refreshing" | "adopting" | "rolling-back" | "discarding">("");
  const [publishArmed, setPublishArmed] = useState(false);
  const [adoptArmed, setAdoptArmed] = useState(false);
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
      setPublishArmed(false);
      setAdoptArmed(false);
      setPrompt("");
      setMessage("提案已封存。请逐文件检查后决定是否创建隔离分支");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "源码提案生成失败");
    } finally {
      setBusy("");
    }
  }

  async function mutate(action: "commit" | "publish" | "refresh" | "adopt" | "rollback" | "discard") {
    if (!proposal) return;
    if (action === "publish" && !publishArmed) {
      setPublishArmed(true);
      setMessage("这一步会推送独立分支并创建 GitHub 草稿 PR；再次点击确认远端操作");
      return;
    }
    if (action === "adopt" && !adoptArmed) {
      setAdoptArmed(true);
      setMessage("将重新核对 GitHub 合并提交、文件范围与哈希；再次点击确认安全快进当前分支");
      return;
    }
    const busyState = {
      commit: "committing",
      publish: "publishing",
      refresh: "refreshing",
      adopt: "adopting",
      rollback: "rolling-back",
      discard: "discarding",
    } as const;
    setBusy(busyState[action]);
    setPublishArmed(false);
    setAdoptArmed(false);
    setMessage({
      commit: "正在临时 worktree 中写入提案、运行固定检查并创建独立提交…",
      publish: "正在推送提案分支，并开启 GitHub 草稿审阅…",
      refresh: "正在读取 GitHub 上的最新审阅状态…",
      adopt: "正在重新验证合并证明、文件范围和哈希，并安全快进当前分支…",
      rollback: "正在核对变更指纹并恢复提案前内容…",
      discard: "正在搁置提案…",
    }[action]);
    try {
      const data = await sourceRequest(`/api/${action}`, { id: proposal.id });
      if (!data.proposal) throw new Error("源码沙箱没有返回结果");
      setProposal(data.proposal);
      if (action === "commit") setMessage(data.proposal.branch ? `已在 ${data.proposal.branch.name} 形成独立提交；当前工作区未改变` : data.proposal.validation?.summary || "隔离验证未通过，没有保留分支");
      else if (action === "publish") setMessage(data.proposal.remoteReview?.url ? "GitHub 草稿审阅已开启，等待人工决定" : "分支已推送，草稿审阅仍待创建");
      else if (action === "refresh") setMessage(data.proposal.remoteReview?.status === "merged" ? "GitHub 已合并；可在再次确认后验证并同步到当前分支" : "远端审阅状态已刷新");
      else if (action === "adopt") setMessage(`已同步 GitHub 合并提交 ${data.proposal.remoteReview?.mergeCommitSha?.slice(0, 12) || ""}；工作区保持干净`);
      else if (action === "rollback") setMessage("已恢复提案前的全部文件");
      else setMessage("提案已搁置，没有改动源码");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "源码操作失败");
      if (action === "publish") {
        sourceRequest("/api/proposals/latest").then((data) => {
          if (data.proposal) setProposal(data.proposal);
        }).catch(() => {});
      }
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
          <p className="lab-lede">Agent 只在一小块源码花园里观察并提案。本地服务把通过审阅的变化送进隔离分支，但模型无法碰触密钥、终端、Git 或自己的安全边界。</p>
        </div>
        <div className={`lab-seal ${online ? "online" : ""}`}>
          <span>✦</span>
          <strong>{online ? "沙箱已密封" : "沙箱离线"}</strong>
          <small>{online ? "127.0.0.1 · 6 道门" : "等待本地服务"}</small>
        </div>
      </div>

      <div className="evolution-route" aria-label="源码变更流程">
        <div className="route-node done"><i>1</i><span><strong>观察</strong><small>只读白名单源码</small></span></div>
        <div className={`route-line ${proposal ? "filled" : ""}`} />
        <div className={`route-node ${proposal ? "done" : ""}`}><i>2</i><span><strong>封装</strong><small>差异与风险检查</small></span></div>
        <div className={`route-line ${proposal?.branch ? "filled" : ""}`} />
        <div className={`route-node ${proposal?.branch ? "done" : proposal?.validation?.status === "failed" ? "failed" : ""}`}><i>3</i><span><strong>提交</strong><small>隔离验证与分支</small></span></div>
        <div className={`route-line ${proposal?.remoteReview ? "filled" : ""}`} />
        <div className={`route-node ${proposal?.remoteReview ? "done" : ""}`}><i>4</i><span><strong>审阅</strong><small>远端草稿 PR</small></span></div>
        <div className={`route-line ${proposal?.status === "adopted" ? "filled" : ""}`} />
        <div className={`route-node ${proposal?.status === "adopted" ? "done" : ""}`}><i>5</i><span><strong>采用</strong><small>验证合并后快进</small></span></div>
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
              {proposal.status === "proposed"
                ? "待确认"
                : proposal.status === "committed"
                  ? "已提交"
                  : proposal.status === "published"
                    ? proposal.remoteReview?.status === "merged" ? "已合并" : "远端审阅中"
                    : proposal.status === "adopted"
                      ? "已同步采用"
                      : proposal.status === "applied"
                        ? "旧版已写入"
                        : proposal.status === "rolled_back"
                          ? "已回滚"
                          : "已搁置"}
            </div>
          </header>

          <div className="source-summary">
            <span><strong>{proposal.files.length}</strong> 个文件</span>
            <span className="add"><strong>+{totals.additions}</strong> 新增</span>
            <span className="remove"><strong>−{totals.deletions}</strong> 删除</span>
            <span><strong>{proposal.baseSha.slice(0, 7)}</strong> {proposal.baseBranch || "Git"} 基线</span>
          </div>

          <div className="guard-strip">
            {proposal.guards.map((guard) => <span key={guard}><i>✓</i>{guard}</span>)}
          </div>

          {proposal.baseBranch ? <section className="git-custody" aria-label="提案 Git 保管链">
            <header><span>Git custody chain</span><strong>{proposal.status === "adopted" ? "已验证合并并同步当前分支" : "当前工作区不承载提案代码"}</strong></header>
            <div>
              <article className="complete"><i>BASE</i><span><small>只读基线</small><code>{proposal.baseBranch || "未知分支"}@{proposal.baseSha.slice(0, 7)}</code></span></article>
              <article className={proposal.branch ? "complete" : proposal.validation?.status === "failed" ? "failed" : "pending"}><i>BR</i><span><small>{proposal.branch ? "隔离分支" : proposal.validation?.status === "failed" ? "验证未通过" : "等待本地确认"}</small><code>{proposal.branch?.name || "尚未创建"}</code></span></article>
              <article className={proposal.branch ? "complete" : "pending"}><i>SHA</i><span><small>自动提交</small><code>{proposal.branch?.commitSha.slice(0, 12) || "只包含提案文件"}</code></span></article>
              <article className={proposal.remoteReview ? "complete" : "pending"}><i>PR</i><span><small>{proposal.remoteReview ? "远端状态" : "独立授权"}</small>{proposal.remoteReview?.url ? <a href={proposal.remoteReview.url} target="_blank" rel="noreferrer">{proposal.remoteReview.status === "draft" ? "草稿审阅" : proposal.remoteReview.status === "open" ? "开放审阅" : proposal.remoteReview.status === "merged" ? "已合并" : proposal.remoteReview.status === "closed" ? "已关闭" : "已推送"} ↗</a> : <code>{proposal.remoteReview?.status === "pushed" ? "分支已推送" : proposal.remoteRepository || "未配置 GitHub origin"}</code>}</span></article>
            </div>
            {proposal.remoteReview && !proposal.remoteReview.inSync && <p className="custody-drift">远端分支已不再指向这份通过验证的提交，请不要合并并先人工核对。</p>}
          </section> : <section className="git-custody legacy-custody" aria-label="旧版提案记录">
            <header><span>Legacy proposal record</span><strong>升级前的本地写入记录</strong></header>
            <p>这份历史提案没有隔离分支元数据，仍按原状态保留用于审计；重新生成的提案会进入新的分支、提交与草稿审阅流程。</p>
          </section>}

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
              {proposal.status === "proposed" && <button className="approve" disabled={Boolean(busy)} onClick={() => void mutate("commit")}>{busy === "committing" ? "正在隔离验证与提交…" : "创建提案分支"}<span>↗</span></button>}
              {(proposal.status === "committed" || (proposal.status === "published" && !proposal.remoteReview?.url)) && <button className={`publish-button ${publishArmed ? "armed" : ""}`} disabled={Boolean(busy)} onClick={() => void mutate("publish")}>{busy === "publishing" ? "正在开启远端审阅…" : publishArmed ? "确认推送并创建草稿 PR" : proposal.status === "published" ? "重试创建草稿 PR" : "推送并开启草稿审阅"}</button>}
              {proposal.status === "published" && proposal.remoteReview?.url && <button className="refresh-review" disabled={Boolean(busy)} onClick={() => void mutate("refresh")}>{busy === "refreshing" ? "正在刷新…" : "刷新审阅状态"}</button>}
              {proposal.status === "published" && proposal.remoteReview?.status === "merged" && proposal.remoteReview.inSync && <button className={`adopt-button ${adoptArmed ? "armed" : ""}`} disabled={Boolean(busy)} onClick={() => void mutate("adopt")}>{busy === "adopting" ? "正在验证并同步…" : adoptArmed ? "确认安全快进当前分支" : "验证并同步已合并版本"}</button>}
              {proposal.remoteReview?.url && <a className="open-review" href={proposal.remoteReview.url} target="_blank" rel="noreferrer">打开 GitHub 审阅 ↗</a>}
              {proposal.status === "applied" && <button className="rollback-button" disabled={Boolean(busy)} onClick={() => void mutate("rollback")}>{busy === "rolling-back" ? "正在恢复…" : "回滚这次变化"}</button>}
            </div>
          </footer>
        </article>
      )}

      <p className="lab-status"><i className={online ? "online" : ""} />{message}</p>
    </section>
  );
}
