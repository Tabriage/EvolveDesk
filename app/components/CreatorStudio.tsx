"use client";

import { FormEvent, useMemo, useState } from "react";
import type {
  CreatorIdea,
  CreatorIdeaDraft,
  CreatorMetrics,
  CreatorProfile,
  CreatorReview,
  CreatorReviewAnalysis,
  CreatorSignal,
  CreatorSourceRef,
  KnowledgeCard,
  PersonalBoard,
  VideoRecord,
  WorkTask,
} from "../features/workbench-core.mjs";

type CreatorStudioProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  profile: CreatorProfile;
  signals: CreatorSignal[];
  ideas: CreatorIdea[];
  reviews: CreatorReview[];
  videos: VideoRecord[];
  knowledge: KnowledgeCard[];
  boards: PersonalBoard[];
  tasks: WorkTask[];
  onNeedSettings: () => void;
  onOpenVideo: () => void;
  onOpenBoards: () => void;
  onSaveProfile: (profile: Partial<CreatorProfile>) => void;
  onAddSignal: (signal: Omit<CreatorSignal, "id" | "createdAt">) => void;
  onRemoveSignal: (signalId: string) => void;
  onSaveIdea: (idea: CreatorIdeaDraft | CreatorIdea) => void;
  onUpdateIdea: (ideaId: string, input: { status?: CreatorIdea["status"]; stepId?: string; stepDone?: boolean }) => void;
  onCreateIdeaTask: (ideaId: string) => void;
  onAddIdeaToBoard: (ideaId: string, boardId: string) => void;
  onRemoveIdea: (ideaId: string) => void;
  onSaveReview: (review: Omit<CreatorReview, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void;
  onRemoveReview: (reviewId: string) => void;
};

type IdeaPack = { theme: string; ideas: CreatorIdeaDraft[] };
type StudioSource = CreatorSourceRef & { label: string };
type ReviewDraft = {
  ideaId: string;
  title: string;
  platform: string;
  url: string;
  publishedAt: string;
  metrics: Record<keyof CreatorMetrics, string>;
  notes: string;
  analysis: CreatorReviewAnalysis | null;
};

const platformChoices = ["小红书", "B站", "抖音", "YouTube", "公众号", "播客"];
const formatLabels: Record<CreatorIdea["format"], string> = { video: "视频", graphic: "图文", article: "文章", live: "直播" };
const statusLabels: Record<CreatorIdea["status"], string> = { idea: "灵感", drafting: "写作中", producing: "制作中", published: "已发布" };
const statusOrder: CreatorIdea["status"][] = ["idea", "drafting", "producing", "published"];
const metricLabels: Record<keyof CreatorMetrics, string> = {
  views: "播放/阅读",
  likes: "点赞",
  comments: "评论",
  saves: "收藏",
  shares: "分享",
  follows: "新增关注",
};

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyReview(): ReviewDraft {
  return {
    ideaId: "",
    title: "",
    platform: "",
    url: "",
    publishedAt: todayKey(),
    metrics: { views: "", likes: "", comments: "", saves: "", shares: "", follows: "" },
    notes: "",
    analysis: null,
  };
}

function emptyManualIdea(platform = ""): CreatorIdeaDraft {
  return {
    title: "",
    promise: "",
    hook: "",
    angle: "",
    format: "video",
    platform,
    sourceRefs: [],
    originalityGuard: "",
    reflection: "这条选题由我手动建立，仍需用真实制作与发布结果验证。",
    steps: [
      { title: "整理素材", note: "" },
      { title: "完成初稿", note: "" },
      { title: "制作并核对", note: "" },
    ],
  };
}

function sourceKey(source: Pick<CreatorSourceRef, "kind" | "id">) {
  return `${source.kind}:${source.id}`;
}

function creatorSourceList(videos: VideoRecord[], knowledge: KnowledgeCard[], signals: CreatorSignal[]): StudioSource[] {
  return [
    ...signals.slice().reverse().map((signal) => ({
      kind: "signal" as const,
      id: signal.id,
      title: signal.title,
      url: signal.url,
      evidence: signal.note,
      label: signal.platform || "观察",
    })),
    ...videos.slice().reverse().map((video) => ({
      kind: "video" as const,
      id: video.id,
      title: video.title,
      url: video.url,
      evidence: [video.summary.oneSentence, video.summary.creatorInsights.hook, video.summary.creatorInsights.structure].filter(Boolean).join("；"),
      label: "视频总结",
    })),
    ...knowledge.slice().reverse().map((card) => ({
      kind: "knowledge" as const,
      id: card.id,
      title: card.title,
      url: card.sourceUrl,
      evidence: card.content,
      label: "知识卡",
    })),
  ].filter((source) => source.title && source.evidence);
}

function ideaReady(idea: CreatorIdeaDraft) {
  return idea.title.trim().length >= 2
    && idea.promise.trim().length >= 4
    && idea.hook.trim().length >= 4
    && idea.angle.trim().length >= 4
    && idea.steps.length >= 3;
}

function metricSummary(metrics: CreatorMetrics) {
  const visible = (Object.keys(metricLabels) as Array<keyof CreatorMetrics>).filter((key) => metrics[key] > 0);
  return visible.length ? visible.slice(0, 3).map((key) => `${metricLabels[key]} ${metrics[key].toLocaleString("zh-CN")}`).join(" · ") : "仅记录了定性观察";
}

export function CreatorStudio({
  baseURL,
  apiKey,
  model,
  profile,
  signals,
  ideas,
  reviews,
  videos,
  knowledge,
  boards,
  tasks,
  onNeedSettings,
  onOpenVideo,
  onOpenBoards,
  onSaveProfile,
  onAddSignal,
  onRemoveSignal,
  onSaveIdea,
  onUpdateIdea,
  onCreateIdeaTask,
  onAddIdeaToBoard,
  onRemoveIdea,
  onSaveReview,
  onRemoveReview,
}: CreatorStudioProps) {
  const activeBoards = useMemo(() => boards.filter((board) => !board.archivedAt), [boards]);
  const sources = useMemo(() => creatorSourceList(videos, knowledge, signals), [videos, knowledge, signals]);
  const [mode, setMode] = useState<"ideas" | "pipeline" | "review">("ideas");
  const [ideaMode, setIdeaMode] = useState<"inspiration" | "remix">("inspiration");
  const [profileDraft, setProfileDraft] = useState(profile);
  const [profileOpen, setProfileOpen] = useState(!profile.niche && !profile.audience);
  const [prompt, setPrompt] = useState("");
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[]>([]);
  const [pack, setPack] = useState<IdeaPack | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<CreatorIdeaDraft>(() => emptyManualIdea(profile.platforms[0] || ""));
  const [busy, setBusy] = useState<"ideas" | "review" | "">("");
  const [message, setMessage] = useState("先写定位，或直接从一个真实来源开始");
  const [signalOpen, setSignalOpen] = useState(false);
  const [signalDraft, setSignalDraft] = useState({ title: "", url: "", note: "", platform: "", observedAt: todayKey() });
  const [activeIdeaId, setActiveIdeaId] = useState("");
  const [boardChoice, setBoardChoice] = useState("");
  const [removeArmed, setRemoveArmed] = useState("");
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>(() => emptyReview());

  const activeIdea = ideas.find((idea) => idea.id === activeIdeaId) || ideas.at(-1) || null;
  const selectedSources = selectedSourceKeys.map((key) => sources.find((source) => sourceKey(source) === key)).filter((source): source is StudioSource => Boolean(source));
  const profileReady = Boolean(profile.niche && profile.audience);

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profileDraft.niche.trim() || !profileDraft.audience.trim()) {
      setMessage("至少写清内容方向和想服务的人");
      return;
    }
    onSaveProfile(profileDraft);
    setProfileOpen(false);
    setMessage("创作定位已保存，Agent 会把它当作边界而不是替你编经历");
  }

  function toggleSource(key: string) {
    setSelectedSourceKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : current.length >= 8 ? current : [...current, key]);
  }

  async function generateIdeas(event: FormEvent) {
    event.preventDefault();
    const request = prompt.trim();
    if (request.length < 4) {
      setMessage("写清今天想表达什么，至少 4 个字符");
      return;
    }
    if (ideaMode === "remix" && !selectedSources.length) {
      setMessage("来源二创先选择一条真实素材；工作台不会把空想包装成热点");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；没有模型时仍可记录信号和发布结果");
      onNeedSettings();
      return;
    }
    setBusy("ideas");
    setMessage(ideaMode === "remix" ? "Agent 正在沿来源证据拆出不同改编角度…" : "Agent 正在根据定位生成待验证选题…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "creator-ideas",
          baseURL,
          apiKey,
          model,
          mode: ideaMode,
          prompt: request,
          profile,
          sources: selectedSources.map(({ kind, id, title, url, evidence }) => ({ kind, id, title, url, evidence })),
        }),
      });
      const data = (await response.json()) as { error?: string; pack?: IdeaPack };
      if (!response.ok || !data.pack) throw new Error(data.error || "模型没有返回创作方案");
      setPack(data.pack);
      setMessage("方案已生成；选中保存前不会写入创作流程");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创作方案生成失败");
    } finally {
      setBusy("");
    }
  }

  function addSignal(event: FormEvent) {
    event.preventDefault();
    if (!signalDraft.title.trim() || signalDraft.note.trim().length < 4) {
      setMessage("观察信号需要标题和一段你真实看到的现象");
      return;
    }
    onAddSignal(signalDraft);
    setSignalDraft({ title: "", url: "", note: "", platform: "", observedAt: todayKey() });
    setSignalOpen(false);
    setMessage("观察信号已保存；它只是你的来源记录，不会被标成全网热点");
  }

  function saveIdea(idea: CreatorIdeaDraft) {
    if (!ideaReady(idea)) return;
    onSaveIdea(idea);
    setPack((current) => current ? { ...current, ideas: current.ideas.filter((item) => item !== idea) } : null);
    setMode("pipeline");
    setActiveIdeaId("");
    setMessage(`已保存「${idea.title}」，现在可以接入任务或业务台`);
  }

  function saveManualIdea(event: FormEvent) {
    event.preventDefault();
    const idea = { ...manualDraft, sourceRefs: selectedSources.map(({ kind, id, title, url, evidence }) => ({ kind, id, title, url, evidence })) };
    if (!ideaReady(idea) || !idea.platform.trim() || !idea.originalityGuard.trim()) {
      setMessage("手动选题还缺标题、价值承诺、开头、角度、平台、原创边界或三个动作");
      return;
    }
    saveIdea(idea);
    setManualDraft(emptyManualIdea(profile.platforms[0] || ""));
    setManualOpen(false);
  }

  function selectReviewIdea(ideaId: string) {
    const idea = ideas.find((item) => item.id === ideaId);
    setReviewDraft((current) => ({
      ...current,
      ideaId,
      title: idea?.title || current.title,
      platform: idea?.platform === "待选择" ? current.platform : idea?.platform || current.platform,
      analysis: null,
    }));
  }

  function reviewPayload() {
    return {
      ideaId: reviewDraft.ideaId || null,
      title: reviewDraft.title.trim(),
      platform: reviewDraft.platform.trim(),
      url: reviewDraft.url.trim(),
      publishedAt: reviewDraft.publishedAt,
      metrics: Object.fromEntries((Object.keys(metricLabels) as Array<keyof CreatorMetrics>).map((key) => [key, Number(reviewDraft.metrics[key]) || 0])) as CreatorMetrics,
      notes: reviewDraft.notes.trim(),
      analysis: reviewDraft.analysis,
    };
  }

  function reviewReady() {
    const payload = reviewPayload();
    return payload.title && payload.platform && payload.publishedAt
      && (payload.notes.length >= 4 || Object.values(reviewDraft.metrics).some((value) => value.trim() !== ""));
  }

  async function generateReview() {
    if (!reviewReady()) {
      setMessage("先填写标题、平台、发布日期，以及至少一项数据或真实观察");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型，或先保存不带 Agent 分析的发布记录");
      onNeedSettings();
      return;
    }
    const linkedIdea = ideas.find((idea) => idea.id === reviewDraft.ideaId);
    setBusy("review");
    setMessage("复盘 Agent 正在区分事实、假设和下一次实验…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "review-content",
          baseURL,
          apiKey,
          model,
          ...reviewDraft,
          idea: linkedIdea ? { title: linkedIdea.title, promise: linkedIdea.promise, hook: linkedIdea.hook, angle: linkedIdea.angle } : null,
        }),
      });
      const data = (await response.json()) as { error?: string; analysis?: CreatorReviewAnalysis };
      if (!response.ok || !data.analysis) throw new Error(data.error || "模型没有返回复盘");
      setReviewDraft((current) => ({ ...current, analysis: data.analysis || null }));
      setMessage("复盘草案已生成；确认保存后才会进入历史记录");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "内容复盘失败");
    } finally {
      setBusy("");
    }
  }

  function saveReview(event: FormEvent) {
    event.preventDefault();
    if (!reviewReady()) {
      setMessage("复盘记录还缺真实标题、平台、日期或结果证据");
      return;
    }
    const payload = reviewPayload();
    onSaveReview(payload);
    setReviewDraft(emptyReview());
    setMessage(payload.analysis ? "内容复盘已保存，下一次实验也进入了工作台记忆" : "发布结果已保存，之后可以补做 Agent 复盘");
  }

  function nextIdeaStatus(idea: CreatorIdea) {
    return statusOrder[statusOrder.indexOf(idea.status) + 1] || null;
  }

  return (
    <section className="creator-studio">
      <header className="workspace-heading creator-heading">
        <div><p className="eyebrow">创作工作室 · 来源到复盘</p><h1>不要追一个抽象的热点，<em>把真实信号变成自己的表达。</em></h1></div>
        <div className="creator-scoreboard"><span><strong>{signals.length + videos.length}</strong>来源</span><span><strong>{ideas.length}</strong>选题</span><span><strong>{reviews.length}</strong>复盘</span></div>
      </header>

      <section className={`creator-profile-strip ${profileOpen ? "editing" : ""}`}>
        {!profileOpen ? <>
          <div><span>创作定位</span><strong>{profile.niche || "还没有写内容方向"}</strong><p>{profile.audience || "先写清想服务谁"}{profile.voice ? ` · ${profile.voice}` : ""}</p></div>
          <div className="creator-platforms">{profile.platforms.length ? profile.platforms.map((platform) => <i key={platform}>{platform}</i>) : <i>平台待选</i>}</div>
          <button onClick={() => setProfileOpen(true)}>调整定位</button>
        </> : <form onSubmit={saveProfile}>
          <label>内容方向<input value={profileDraft.niche} onChange={(event) => setProfileDraft({ ...profileDraft, niche: event.target.value.slice(0, 120) })} placeholder="例如：AI 工作流与个人知识管理" /></label>
          <label>想服务的人<input value={profileDraft.audience} onChange={(event) => setProfileDraft({ ...profileDraft, audience: event.target.value.slice(0, 220) })} placeholder="例如：想自己搭工具的独立创作者" /></label>
          <label>表达气质<input value={profileDraft.voice} onChange={(event) => setProfileDraft({ ...profileDraft, voice: event.target.value.slice(0, 220) })} placeholder="例如：具体、克制、有实验感" /></label>
          <fieldset><legend>常用平台</legend>{platformChoices.map((platform) => <label key={platform}><input type="checkbox" checked={profileDraft.platforms.includes(platform)} onChange={(event) => setProfileDraft({ ...profileDraft, platforms: event.target.checked ? [...profileDraft.platforms, platform].slice(0, 8) : profileDraft.platforms.filter((item) => item !== platform) })} />{platform}</label>)}</fieldset>
          <div><button type="button" onClick={() => setProfileOpen(false)}>取消</button><button disabled={!profileDraft.niche.trim() || !profileDraft.audience.trim()}>保存定位</button></div>
        </form>}
      </section>

      <nav className="creator-mode-tabs" aria-label="创作工作室模式">
        <button className={mode === "ideas" ? "active" : ""} onClick={() => setMode("ideas")}><i>01</i><span>灵感与二创<small>从证据形成表达</small></span></button>
        <button className={mode === "pipeline" ? "active" : ""} onClick={() => setMode("pipeline")}><i>02</i><span>制作推进<small>{ideas.filter((idea) => idea.status !== "published").length} 条仍在推进</small></span></button>
        <button className={mode === "review" ? "active" : ""} onClick={() => setMode("review")}><i>03</i><span>发布复盘<small>观察不等于因果</small></span></button>
      </nav>
      <p className="creator-message"><i className={busy ? "busy" : ""} />{message}</p>

      {mode === "ideas" && <>
        <section className="creator-filmstrip">
          <header><div><span>证据胶片 · 选择 0–8 条</span><strong>{selectedSources.length} 条已选</strong></div><div><button onClick={() => setSignalOpen((open) => !open)}>＋ 记录观察信号</button><button onClick={onOpenVideo}>＋ 总结视频</button></div></header>
          {signalOpen && <form className="creator-signal-form" onSubmit={addSignal}>
            <input value={signalDraft.title} onChange={(event) => setSignalDraft({ ...signalDraft, title: event.target.value.slice(0, 120) })} placeholder="你观察到的内容或讨论" aria-label="观察信号标题" />
            <input value={signalDraft.platform} onChange={(event) => setSignalDraft({ ...signalDraft, platform: event.target.value.slice(0, 30) })} placeholder="来源平台" aria-label="观察信号平台" />
            <input type="date" value={signalDraft.observedAt} onInput={(event) => setSignalDraft({ ...signalDraft, observedAt: event.currentTarget.value })} aria-label="观察日期" />
            <input value={signalDraft.url} onChange={(event) => setSignalDraft({ ...signalDraft, url: event.target.value.slice(0, 2_000) })} placeholder="原链接（可选）" aria-label="观察信号链接" />
            <textarea value={signalDraft.note} onChange={(event) => setSignalDraft({ ...signalDraft, note: event.target.value.slice(0, 600) })} placeholder="只写你真实看到的现象，不猜全网热度…" aria-label="观察信号内容" />
            <button disabled={!signalDraft.title.trim() || signalDraft.note.trim().length < 4}>保存信号</button>
          </form>}
          <div className="creator-film-reel">
            {sources.slice(0, 24).map((source, index) => {
              const key = sourceKey(source);
              const selected = selectedSourceKeys.includes(key);
              return <article className={selected ? "selected" : ""} key={key}>
                <button className="creator-source-main" onClick={() => toggleSource(key)} aria-pressed={selected}><i>{String(index + 1).padStart(2, "0")}</i><small>{source.label}</small><strong>{source.title}</strong><p>{source.evidence}</p><span>{selected ? "已选为证据" : "选择这条来源"}</span></button>
                <footer>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">原来源 ↗</a> : <span>没有外部链接</span>}{source.kind === "signal" && <button aria-label={`移除${source.title}`} onClick={() => onRemoveSignal(source.id)}>×</button>}</footer>
              </article>;
            })}
            {!sources.length && <div className="creator-source-empty"><span>▱</span><strong>还没有可引用的素材</strong><p>记录一个亲眼看到的现象，或者先总结一条视频。原创灵感仍可不带来源生成。</p></div>}
          </div>
        </section>

        <form className="creator-idea-composer" onSubmit={generateIdeas}>
          <div className="creator-idea-mode"><button type="button" className={ideaMode === "inspiration" ? "active" : ""} onClick={() => setIdeaMode("inspiration")}>每日灵感</button><button type="button" className={ideaMode === "remix" ? "active" : ""} onClick={() => setIdeaMode("remix")}>来源二创</button><button type="button" className={manualOpen ? "active" : ""} onClick={() => { setManualOpen((open) => !open); setManualDraft((current) => ({ ...current, platform: current.platform || profile.platforms[0] || "" })); }}>自己写一条</button></div>
          <label><span>{ideaMode === "remix" ? "怎样把这些素材转成你的表达？" : "今天真正想讲清什么？"}</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 1_200))} placeholder={profileReady ? "例如：为什么个人工作台真正重要的不是页面，而是可持续推进的反馈回路…" : "也可以先写一个具体问题，之后再补创作定位…"} /></label>
          <div><small>{ideaMode === "remix" ? `${selectedSources.length} 条真实来源会随请求发给本地模型` : "没有来源时，Agent 会明确标为待验证原创命题"}</small><button disabled={busy === "ideas" || prompt.trim().length < 4}>{busy === "ideas" ? "正在拆解…" : "生成 3 个可编辑方案"}<b>↗</b></button></div>
        </form>

        {manualOpen && <form className="creator-manual-idea" onSubmit={saveManualIdea}>
          <header><div><span>手动选题 · 不需要模型</span><h2>把你已经想清楚的部分直接写下来。</h2></div><small>{selectedSources.length} 条所选来源会随选题保存</small></header>
          <div className="creator-manual-grid">
            <label>选题标题<input value={manualDraft.title} onChange={(event) => setManualDraft({ ...manualDraft, title: event.target.value.slice(0, 120) })} placeholder="一句话说清要做什么" /></label>
            <label>发布平台<input value={manualDraft.platform} onChange={(event) => setManualDraft({ ...manualDraft, platform: event.target.value.slice(0, 30) })} placeholder="例如：B站" /></label>
            <label>内容形式<select value={manualDraft.format} onChange={(event) => setManualDraft({ ...manualDraft, format: event.target.value as CreatorIdea["format"] })}>{Object.entries(formatLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="wide">价值承诺<input value={manualDraft.promise} onChange={(event) => setManualDraft({ ...manualDraft, promise: event.target.value.slice(0, 300) })} placeholder="看完之后，对方具体能得到什么？" /></label>
            <label className="wide">开头钩子<textarea value={manualDraft.hook} onChange={(event) => setManualDraft({ ...manualDraft, hook: event.target.value.slice(0, 300) })} placeholder="先写一句愿意真正说出口的开头…" /></label>
            <label className="wide">自己的角度<textarea value={manualDraft.angle} onChange={(event) => setManualDraft({ ...manualDraft, angle: event.target.value.slice(0, 500) })} placeholder="你会增加什么自己的经验、证据或验证？" /></label>
            <label className="wide">原创边界<textarea value={manualDraft.originalityGuard} onChange={(event) => setManualDraft({ ...manualDraft, originalityGuard: event.target.value.slice(0, 500) })} placeholder="哪些表达不能照搬，你准备怎样形成自己的版本？" /></label>
          </div>
          <section><header><span>三个制作动作</span><small>可继续细化</small></header>{manualDraft.steps.map((step, index) => <div key={index}><i>{index + 1}</i><input value={step.title} onChange={(event) => setManualDraft({ ...manualDraft, steps: manualDraft.steps.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value.slice(0, 120) } : item) })} aria-label={`制作动作 ${index + 1}`} /><input value={step.note} onChange={(event) => setManualDraft({ ...manualDraft, steps: manualDraft.steps.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value.slice(0, 320) } : item) })} placeholder="完成标准或提醒" aria-label={`制作动作 ${index + 1} 说明`} /></div>)}</section>
          <footer><button type="button" onClick={() => setManualOpen(false)}>取消</button><button disabled={!ideaReady(manualDraft) || !manualDraft.platform.trim() || !manualDraft.originalityGuard.trim()}>保存并进入制作流程 <span>↗</span></button></footer>
        </form>}

        {pack ? <section className="creator-proposal-board">
          <header><div><span>本次主题</span><h2>{pack.theme}</h2></div><button onClick={() => setPack(null)}>搁置全部</button></header>
          <div>{pack.ideas.map((idea, index) => <article key={`${idea.title}-${index}`}>
            <header><i>{String(index + 1).padStart(2, "0")}</i><span>{idea.platform} · {formatLabels[idea.format]}</span></header>
            <h3>{idea.title}</h3><p className="creator-promise">看完得到：{idea.promise}</p>
            <blockquote>{idea.hook}</blockquote>
            <div className="creator-angle"><span>你的角度</span><p>{idea.angle}</p></div>
            <div className="creator-source-chips">{idea.sourceRefs.length ? idea.sourceRefs.map((source) => <i key={sourceKey(source)}>⌁ {source.title}</i>) : <i>待验证原创命题</i>}</div>
            <details><summary>查看制作动作与原创边界</summary><ol>{idea.steps.map((step) => <li key={step.title}><strong>{step.title}</strong><span>{step.note}</span></li>)}</ol><p><b>不照搬：</b>{idea.originalityGuard}</p><p><b>Agent 自省：</b>{idea.reflection}</p></details>
            <button className="creator-save-idea" disabled={!ideaReady(idea)} onClick={() => saveIdea(idea)}>保存并进入制作流程 <span>↗</span></button>
          </article>)}</div>
        </section> : <section className="creator-idea-empty"><div className="creator-empty-hook"><i>HOOK</i><span /><b>?</b></div><div><strong>先生成，不会自动采用</strong><p>Agent 会给出不同角度、开头和制作步骤。你只保存真正愿意做的一条。</p></div></section>}
      </>}

      {mode === "pipeline" && <section className="creator-pipeline">
        {!ideas.length ? <div className="creator-pipeline-empty"><span>02</span><strong>还没有进入制作的选题</strong><p>先在“灵感与二创”里保存一个方案。</p><button onClick={() => setMode("ideas")}>去形成第一条选题</button></div> : <>
          <div className="creator-stage-lanes">{statusOrder.map((status) => <section key={status}><header><i /><strong>{statusLabels[status]}</strong><span>{ideas.filter((idea) => idea.status === status).length}</span></header>{ideas.filter((idea) => idea.status === status).map((idea) => <button className={activeIdea?.id === idea.id ? "active" : ""} key={idea.id} onClick={() => { setActiveIdeaId(idea.id); setRemoveArmed(""); }}><small>{idea.platform} · {formatLabels[idea.format]}</small><strong>{idea.title}</strong><span>{idea.steps.filter((step) => step.done).length}/{idea.steps.length} 动作完成</span></button>)}</section>)}</div>
          {activeIdea && <article className="creator-active-brief">
            <header><div><p className="eyebrow">正在打磨 · {statusLabels[activeIdea.status]}</p><h2>{activeIdea.title}</h2><span>{activeIdea.platform} · {formatLabels[activeIdea.format]}</span></div><button className={removeArmed === activeIdea.id ? "armed" : ""} onClick={() => { if (removeArmed === activeIdea.id) { onRemoveIdea(activeIdea.id); setActiveIdeaId(""); setRemoveArmed(""); } else setRemoveArmed(activeIdea.id); }}>{removeArmed === activeIdea.id ? "再次确认移除" : "移除"}</button></header>
            <div className="creator-brief-grid"><section><span>价值承诺</span><p>{activeIdea.promise}</p></section><section><span>开头钩子</span><blockquote>{activeIdea.hook}</blockquote></section><section><span>自己的角度</span><p>{activeIdea.angle}</p></section><section><span>原创边界</span><p>{activeIdea.originalityGuard}</p></section></div>
            <div className="creator-step-list"><header><span>制作动作</span><strong>{activeIdea.steps.filter((step) => step.done).length}/{activeIdea.steps.length}</strong></header>{activeIdea.steps.map((step, index) => <label key={step.id} className={step.done ? "done" : ""}><input type="checkbox" checked={step.done} onChange={(event) => onUpdateIdea(activeIdea.id, { stepId: step.id, stepDone: event.target.checked })} /><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{step.title}</strong><small>{step.note}</small></span></label>)}</div>
            <div className="creator-brief-actions">
              {activeIdea.linkedTaskId && tasks.some((task) => task.id === activeIdea.linkedTaskId) ? <span>✓ 已接入今日任务</span> : <button onClick={() => onCreateIdeaTask(activeIdea.id)}>转为今日任务</button>}
              {activeIdea.linkedBoardId && activeIdea.linkedBoardRecordId ? <span>✓ 已接入业务台</span> : activeBoards.length ? <label>加入业务台<select value={boardChoice} onChange={(event) => setBoardChoice(event.target.value)}><option value="">选择业务台</option>{activeBoards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select><button disabled={!boardChoice} onClick={() => { onAddIdeaToBoard(activeIdea.id, boardChoice); setBoardChoice(""); }}>接入</button></label> : <button onClick={onOpenBoards}>先建立内容业务台</button>}
              {nextIdeaStatus(activeIdea) && <button className="creator-advance" onClick={() => onUpdateIdea(activeIdea.id, { status: nextIdeaStatus(activeIdea)! })}>推进到{statusLabels[nextIdeaStatus(activeIdea)!]} →</button>}
              {activeIdea.status === "published" && <button className="creator-review-link" onClick={() => { setMode("review"); selectReviewIdea(activeIdea.id); }}>记录发布结果</button>}
            </div>
            <footer><span>证据来源</span>{activeIdea.sourceRefs.length ? activeIdea.sourceRefs.map((source) => source.url ? <a key={sourceKey(source)} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : <i key={sourceKey(source)}>{source.title}</i>) : <i>待验证原创命题，没有外部来源</i>}</footer>
          </article>}
        </>}
      </section>}

      {mode === "review" && <section className="creator-review-room">
        <form className="creator-review-form" onSubmit={saveReview}>
          <header><div><span>发布事实</span><h2>先记发生了什么，再讨论为什么。</h2></div><small>所有数据由你填写</small></header>
          <div className="creator-review-basics">
            <label>连接创作选题<select value={reviewDraft.ideaId} onChange={(event) => selectReviewIdea(event.target.value)}><option value="">不连接</option>{ideas.map((idea) => <option key={idea.id} value={idea.id}>{idea.title}</option>)}</select></label>
            <label>内容标题<input value={reviewDraft.title} onChange={(event) => setReviewDraft({ ...reviewDraft, title: event.target.value.slice(0, 120), analysis: null })} /></label>
            <label>发布平台<input value={reviewDraft.platform} onChange={(event) => setReviewDraft({ ...reviewDraft, platform: event.target.value.slice(0, 30), analysis: null })} placeholder="例如：B站" /></label>
            <label>发布日期<input type="date" value={reviewDraft.publishedAt} onInput={(event) => setReviewDraft({ ...reviewDraft, publishedAt: event.currentTarget.value, analysis: null })} /></label>
            <label className="wide">发布链接<input value={reviewDraft.url} onChange={(event) => setReviewDraft({ ...reviewDraft, url: event.target.value.slice(0, 2_000) })} placeholder="可选；用于之后回到原内容" /></label>
          </div>
          <div className="creator-metric-grid">{(Object.keys(metricLabels) as Array<keyof CreatorMetrics>).map((key) => <label key={key}><span>{metricLabels[key]}</span><input type="number" min="0" inputMode="numeric" value={reviewDraft.metrics[key]} onInput={(event) => setReviewDraft({ ...reviewDraft, metrics: { ...reviewDraft.metrics, [key]: event.currentTarget.value.slice(0, 15) }, analysis: null })} placeholder="未填写" /></label>)}</div>
          <label className="creator-review-notes">你的真实观察<textarea value={reviewDraft.notes} onChange={(event) => setReviewDraft({ ...reviewDraft, notes: event.target.value.slice(0, 1_200), analysis: null })} placeholder="例如：评论主要追问搭建步骤；封面是否有效还无法判断…" /></label>
          <div className="creator-review-actions"><button type="button" disabled={busy === "review" || !reviewReady()} onClick={() => void generateReview()}>{busy === "review" ? "正在区分事实与假设…" : "让 Agent 生成复盘"}</button><button disabled={!reviewReady()}>保存{reviewDraft.analysis ? "完整复盘" : "发布记录"} <span>↗</span></button></div>
        </form>

        <aside className="creator-analysis-preview">
          {reviewDraft.analysis ? <>
            <header><span>Agent 复盘草案</span><h3>{reviewDraft.analysis.headline}</h3></header>
            <section><strong>能够观察</strong>{reviewDraft.analysis.observations.map((observation) => <p key={observation.claim}><i>DATA</i>{observation.claim}<small>{observation.metricKeys.map((key) => metricLabels[key]).join(" · ")}</small></p>)}</section>
            <section><strong>仍是假设</strong>{reviewDraft.analysis.hypotheses.map((hypothesis) => <p key={hypothesis.idea}><i>{hypothesis.confidence === "medium" ? "中" : "低"}</i>{hypothesis.idea}</p>)}</section>
            {reviewDraft.analysis.gaps.length > 0 && <section><strong>资料缺口</strong>{reviewDraft.analysis.gaps.map((gap) => <p key={gap}>! {gap}</p>)}</section>}
            <section className="creator-next-experiment"><strong>下一条只改一个变量</strong><h4>{reviewDraft.analysis.nextExperiment.change}</h4><p>{reviewDraft.analysis.nextExperiment.reason}</p><small>验收：{reviewDraft.analysis.nextExperiment.successSignal}</small></section>
            <footer><span>✦ 自省</span><p>{reviewDraft.analysis.reflection}</p></footer>
          </> : <div className="creator-analysis-empty"><div><i>事实</i><span>→</span><i>假设</i><span>→</span><i>实验</i></div><strong>复盘不会替数据讲故事</strong><p>填写真实结果后，Agent 会把观察、低置信度假设和下一次实验分开。</p></div>}
        </aside>

        {reviews.length > 0 && <section className="creator-review-history"><header><span>复盘历史</span><strong>{reviews.length} 次</strong></header><div>{reviews.slice().reverse().map((review) => <article key={review.id}><header><span>{review.platform} · {review.publishedAt}</span><button className={removeArmed === review.id ? "armed" : ""} onClick={() => { if (removeArmed === review.id) { onRemoveReview(review.id); setRemoveArmed(""); } else setRemoveArmed(review.id); }}>{removeArmed === review.id ? "确认" : "×"}</button></header><h3>{review.title}</h3><p>{metricSummary(review.metrics)}</p>{review.analysis ? <><blockquote>{review.analysis.headline}</blockquote><small>下次实验：{review.analysis.nextExperiment.change}</small></> : <small>{review.notes}</small>}{review.url && <a href={review.url} target="_blank" rel="noreferrer">打开发布内容 ↗</a>}</article>)}</div></section>}
      </section>}
    </section>
  );
}
