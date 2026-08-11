"use client";

import { useMemo, useState } from "react";
import type {
  KnowledgeCard,
  LearningMap,
  LearningMapNode,
  LearningSourceRef,
  LearningTopic,
  VideoRecord,
} from "../features/workbench-core.mjs";

type TopicDraft = Omit<LearningTopic, "createdAt" | "updatedAt">;

type LearningTopicStudioProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  videos: VideoRecord[];
  knowledge: KnowledgeCard[];
  topics: LearningTopic[];
  onNeedSettings: () => void;
  onOpenVideo: () => void;
  onOpenKnowledge: () => void;
  onSave: (topic: TopicDraft, actor: "human" | "agent") => void;
  onRemove: (topicId: string) => void;
  onCreateTask: (task: { title: string; note: string }) => void;
};

type SourceItem = LearningSourceRef & {
  title: string;
  origin: string;
  originKey: string;
  digest: string;
};

const nodeKindLabels: Record<LearningMapNode["kind"], string> = {
  idea: "理解",
  method: "方法",
  evidence: "证据",
  contrast: "分歧",
};

const relationLabels: Record<LearningMap["edges"][number]["relation"], string> = {
  supports: "支持",
  extends: "补充",
  contrasts: "存在边界",
  depends_on: "依赖",
};

function sourceKey(source: LearningSourceRef) {
  return `${source.kind}:${source.id}`;
}

function createTopicId() {
  return `learning-topic-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
}

function videoDigest(video: VideoRecord) {
  const summary = video.summary;
  return [
    summary.oneSentence,
    ...summary.keyPoints.slice(0, 6).map((point) => `${point.title}：${point.detail}`),
    ...summary.visualFindings.slice(0, 3).map((finding) => `画面 ${finding.timestamp}：${finding.observation}`),
    ...summary.caveats.slice(0, 3).map((caveat) => `边界：${caveat}`),
  ].filter(Boolean).join("；").slice(0, 2_400);
}

function knowledgeDigest(card: KnowledgeCard) {
  return `${card.content}${card.tags.length ? `；标签：${card.tags.join("、")}` : ""}`.slice(0, 2_400);
}

function sameSources(left: LearningSourceRef[], right: LearningSourceRef[]) {
  const leftKeys = left.map(sourceKey).sort();
  const rightKeys = right.map(sourceKey).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

export function LearningTopicStudio({
  baseURL,
  apiKey,
  model,
  videos,
  knowledge,
  topics,
  onNeedSettings,
  onOpenVideo,
  onOpenKnowledge,
  onSave,
  onRemove,
  onCreateTask,
}: LearningTopicStudioProps) {
  const sources = useMemo<SourceItem[]>(() => [
    ...videos.slice().reverse().map((video) => ({
      kind: "video" as const,
      id: video.id,
      title: video.title,
      origin: `${video.author || "未署名"} · ${video.platform}`,
      originKey: video.url,
      digest: videoDigest(video),
    })),
    ...knowledge.slice().reverse().map((card) => ({
      kind: "knowledge" as const,
      id: card.id,
      title: card.title,
      origin: card.sourceTitle || "本地知识卡",
      originKey: card.sourceUrl || `knowledge:${card.id}`,
      digest: knowledgeDigest(card),
    })),
  ], [knowledge, videos]);
  const sourceIndex = useMemo(() => new Map(sources.map((source) => [sourceKey(source), source])), [sources]);
  const initialTopic = topics.at(-1) || null;
  const [draftId, setDraftId] = useState(initialTopic?.id || createTopicId());
  const [title, setTitle] = useState(initialTopic?.title || "");
  const [goal, setGoal] = useState(initialTopic?.goal || "");
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => initialTopic?.sources.map(sourceKey) || sources.slice(0, 4).map(sourceKey));
  const [activeNodeId, setActiveNodeId] = useState(initialTopic?.map?.nodes[0]?.id || "");
  const [sourceFilter, setSourceFilter] = useState<"all" | "video" | "knowledge">("all");
  const [addedQuestionIds, setAddedQuestionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(sources.length >= 2 ? "先钉住真实资料，再让 Agent 编织它们之间的关系" : "至少需要两条视频或知识卡资料");
  const activeTopic = topics.find((topic) => topic.id === draftId) || null;
  const selectedSources = selectedKeys.map((key) => sourceIndex.get(key)).filter((source): source is SourceItem => Boolean(source));
  const draftSources = selectedSources.map(({ kind, id }) => ({ kind, id }));
  const map = activeTopic && activeTopic.goal === goal.trim() && sameSources(activeTopic.sources, draftSources) ? activeTopic.map : null;
  const activeNode = map?.nodes.find((node) => node.id === activeNodeId) || map?.nodes[0] || null;
  const visibleSources = sources.filter((source) => sourceFilter === "all" || source.kind === sourceFilter);
  const originalSourceCount = new Set(selectedSources.map((source) => source.originKey)).size;

  function selectTopic(topic: LearningTopic) {
    setDraftId(topic.id);
    setTitle(topic.title);
    setGoal(topic.goal);
    setSelectedKeys(topic.sources.map(sourceKey));
    setActiveNodeId(topic.map?.nodes[0]?.id || "");
    setAddedQuestionIds([]);
    setMessage(topic.map ? "已打开保存的证据脉络；选择节点可回查资料" : "资料架已保存，可以继续调整或生成脉络");
  }

  function startNew() {
    setDraftId(createTopicId());
    setTitle("");
    setGoal("");
    setSelectedKeys(sources.slice(0, 4).map(sourceKey));
    setActiveNodeId("");
    setAddedQuestionIds([]);
    setMessage("新专题不会预填结论；先写下真正想弄清的问题");
  }

  function toggleSource(source: SourceItem) {
    const key = sourceKey(source);
    if (!selectedKeys.includes(key) && selectedKeys.length >= 16) {
      setMessage("一个专题最多钉住 16 条资料；先移除一条再继续");
      return;
    }
    setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    setActiveNodeId("");
    setMessage(map ? "资料发生变化；旧脉络暂不沿用，重新生成后再保存" : "资料架已更新，尚未写入本地专题");
  }

  function validDraft() {
    if (title.trim().length < 2) {
      setMessage("给专题一个至少 2 个字符的名字");
      return false;
    }
    if (goal.trim().length < 4) {
      setMessage("写下至少 4 个字符的学习问题，Agent 才知道围绕什么组织资料");
      return false;
    }
    if (selectedSources.length < 2) {
      setMessage("至少选择两条真实资料，才能建立多来源专题");
      return false;
    }
    return true;
  }

  function saveShelf() {
    if (!validDraft()) return;
    onSave({ id: draftId, title: title.trim(), goal: goal.trim(), sources: draftSources, map }, "human");
    setMessage(map ? "专题与当前脉络已保存到本机" : "资料架已保存；现在可以让 Agent 编织脉络");
  }

  async function buildMap() {
    if (!validDraft()) return;
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；只会发送当前选择的摘要与知识卡内容");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setMessage(`正在核对 ${selectedSources.length} 条资料，分开共同结论、分歧和资料缺口…`);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "build-learning-topic",
          baseURL,
          apiKey,
          model,
          title: title.trim(),
          goal: goal.trim(),
          sources: selectedSources.map(({ kind, id, title: sourceTitle, digest }) => ({ kind, id, title: sourceTitle, digest })),
        }),
      });
      const data = (await response.json()) as { error?: string; map?: LearningMap };
      if (!response.ok || !data.map) throw new Error(data.error || "模型没有返回学习脉络");
      onSave({ id: draftId, title: title.trim(), goal: goal.trim(), sources: draftSources, map: data.map }, "agent");
      setActiveNodeId(data.map.nodes[0]?.id || "");
      setMessage(`已保存 ${data.map.nodes.length} 个有据节点和 ${data.map.openQuestions.length} 个待求证问题`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "学习脉络生成失败");
    } finally {
      setBusy(false);
    }
  }

  function removeTopic() {
    if (!activeTopic || !window.confirm(`移除学习专题「${activeTopic.title}」？原视频和知识卡不会被删除。`)) return;
    onRemove(activeTopic.id);
    startNew();
    setMessage("专题已移除；原始视频和知识卡仍然保留");
  }

  function createQuestionTask(question: LearningMap["openQuestions"][number]) {
    if (addedQuestionIds.includes(question.id)) return;
    onCreateTask({ title: question.question, note: `来自学习专题「${title}」 · 待补证据：${question.reason}` });
    setAddedQuestionIds((current) => [...current, question.id]);
    setMessage("开放问题已加入今日任务；原专题仍保留为证据入口");
  }

  if (sources.length < 2) {
    return (
      <section className="learning-studio learning-empty">
        <p className="eyebrow">学习专题 · 多来源脉络</p>
        <h1>一条资料只能留下摘要，<br /><em>两条以后才开始形成理解。</em></h1>
        <div><span>⌘</span><section><strong>还缺少可编织的资料</strong><p>先保存至少两个视频总结或知识卡。专题不会从标题猜结论，也不会预置示例数据。</p><button onClick={onOpenVideo}>继续收集视频 <b>↗</b></button></section></div>
      </section>
    );
  }

  return (
    <section className="learning-studio">
      <div className="workspace-heading learning-heading">
        <div><p className="eyebrow">学习专题 · SOURCE LOOM</p><h1>把零散资料，<em>编织成可回查的理解。</em></h1></div>
        <div className="learning-stats"><span><strong>{topics.length}</strong> 专题</span><span><strong>{sources.length}</strong> 资料</span><span><strong>{originalSourceCount}</strong> 当前来源</span></div>
      </div>

      <div className="topic-switcher">
        <div>{topics.slice().reverse().map((topic) => <button className={topic.id === draftId ? "active" : ""} key={topic.id} onClick={() => selectTopic(topic)}><i>{topic.map ? "●" : "○"}</i><span>{topic.title}<small>{topic.sources.length} 条资料 · {topic.map?.nodes.length || 0} 节点</small></span></button>)}</div>
        <button className="topic-new" onClick={startNew}>＋ 新专题</button>
      </div>

      <div className="topic-brief">
        <label><span>专题名称</span><input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 100))} placeholder="例如：怎样建立不依赖意志力的学习系统" /></label>
        <label><span>这次真正想弄清什么</span><textarea value={goal} onChange={(event) => setGoal(event.target.value.slice(0, 500))} placeholder="写成一个具体问题：哪些方法相互支持，哪些只适用于特定情境？" /></label>
        <div><button className="topic-save" onClick={saveShelf}>保存资料架</button><button className="topic-weave" onClick={() => void buildMap()} disabled={busy}>{busy ? "正在编织…" : map ? "重新生成脉络 ✦" : "生成证据脉络 ✦"}</button>{activeTopic && <button className="topic-remove" onClick={removeTopic} aria-label="移除当前专题">移除</button>}</div>
      </div>

      <div className="source-loom">
        <aside className="source-pins">
          <header><div><span>SOURCE PINS</span><strong>{selectedSources.length}/16 条已钉住</strong></div><nav><button className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>全部</button><button className={sourceFilter === "video" ? "active" : ""} onClick={() => setSourceFilter("video")}>视频</button><button className={sourceFilter === "knowledge" ? "active" : ""} onClick={() => setSourceFilter("knowledge")}>卡片</button></nav></header>
          <div>{visibleSources.map((source) => {
            const selected = selectedKeys.includes(sourceKey(source));
            return <button className={selected ? "selected" : ""} key={sourceKey(source)} onClick={() => toggleSource(source)} aria-pressed={selected}><i>{source.kind === "video" ? "V" : "K"}</i><span><strong>{source.title}</strong><small>{source.origin}</small></span><b>{selected ? "✓" : "+"}</b></button>;
          })}</div>
        </aside>

        <section className={`learning-map ${map ? "has-map" : ""}`}>
          <header><span>UNDERSTANDING MAP</span><strong>{map ? `${map.nodes.length} 个节点 · ${map.edges.length} 条关系` : "等待编织"}</strong></header>
          {map ? <>
            <article className="map-thesis"><small>中心理解</small><h2>{map.thesis}</h2><span>{selectedSources.length} 条资料共同限定</span></article>
            <div className="map-thread" aria-hidden="true"><i /><i /><i /></div>
            <div className="map-node-grid">{map.nodes.map((node, index) => {
              const incoming = map.edges.filter((edge) => edge.to === node.id);
              return <button className={`${node.kind} ${activeNode?.id === node.id ? "active" : ""}`} key={node.id} onClick={() => setActiveNodeId(node.id)}><small><i>{String(index + 1).padStart(2, "0")}</i>{nodeKindLabels[node.kind]} · {node.sourceRefs.length} 证据</small><strong>{node.title}</strong><p>{node.summary}</p>{incoming.length > 0 && <span>{incoming.map((edge) => relationLabels[edge.relation]).join(" · ")}</span>}</button>;
            })}</div>
            {map.edges.length > 0 && <div className="map-relations"><span>关系索引</span>{map.edges.map((edge, index) => {
              const from = map.nodes.find((node) => node.id === edge.from);
              const to = map.nodes.find((node) => node.id === edge.to);
              return <p key={`${edge.from}-${edge.to}-${index}`}><i>{relationLabels[edge.relation]}</i><strong>{from?.title}</strong><b>→</b><strong>{to?.title}</strong><small>{edge.label}</small></p>;
            })}</div>}
          </> : <div className="map-empty"><div><i /><i /><i /><span>⌘</span></div><strong>{selectedSources.length} 条资料已经就位</strong><p>Agent 只读取左侧选中的摘要和知识卡，不能调用外部常识。保存资料架不需要模型。</p><button onClick={() => void buildMap()} disabled={busy}>{busy ? "正在核对来源…" : "编织第一张脉络"}</button></div>}
        </section>

        <aside className="topic-inspector">
          <header><span>TRACE / GAPS</span><strong>{activeNode ? "节点证据" : "待求证区"}</strong></header>
          {activeNode ? <section className="node-trace"><small>{nodeKindLabels[activeNode.kind]}</small><h3>{activeNode.title}</h3><p>{activeNode.summary}</p><div>{activeNode.sourceRefs.map((ref) => {
            const source = sourceIndex.get(sourceKey(ref));
            return <button key={sourceKey(ref)} onClick={ref.kind === "video" ? onOpenVideo : onOpenKnowledge}><i>{ref.kind === "video" ? "V" : "K"}</i><span><strong>{source?.title || "来源已不可用"}</strong><small>{source?.origin || "需要重新选择资料"}</small></span><b>↗</b></button>;
          })}</div></section> : <div className="trace-empty"><span>◎</span><p>生成脉络后，选择一个节点查看它究竟由哪些资料支持。</p></div>}
          <section className="open-questions"><div><span>OPEN QUESTIONS</span><strong>{map?.openQuestions.length || 0}</strong></div>{map?.openQuestions.length ? map.openQuestions.map((question) => <article key={question.id}><i>?</i><strong>{question.question}</strong><p>{question.reason}</p><button disabled={addedQuestionIds.includes(question.id)} onClick={() => createQuestionTask(question)}>{addedQuestionIds.includes(question.id) ? "已加入今日任务" : "加入求证任务 ↗"}</button></article>) : <p>{map ? "当前脉络没有单列资料缺口；仍应回看节点来源。" : "没有脉络时不会伪造开放问题。"}</p>}</section>
        </aside>
      </div>

      <p className="learning-message"><i className={busy ? "busy" : ""} />{message}</p>
    </section>
  );
}
