"use client";

import { useMemo, useState } from "react";
import { compareLearningMaps } from "../features/workbench-core.mjs";
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

type TopicRevisionNote = {
  summary: string;
  preserved: string[];
  changed: string[];
  removed: string[];
  caution: string;
};

type PendingTopicRevision = {
  signature: string;
  map: LearningMap;
  revision: TopicRevisionNote;
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

function draftSignature(title: string, goal: string, sources: LearningSourceRef[]) {
  return JSON.stringify({ title: title.trim(), goal: goal.trim(), sources: sources.map(sourceKey).sort() });
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
  const [pendingRevision, setPendingRevision] = useState<PendingTopicRevision | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(sources.length >= 2 ? "先钉住真实资料，再让 Agent 编织它们之间的关系" : "至少需要两条视频或知识卡资料");
  const activeTopic = topics.find((topic) => topic.id === draftId) || null;
  const selectedSources = selectedKeys.map((key) => sourceIndex.get(key)).filter((source): source is SourceItem => Boolean(source));
  const draftSources = selectedSources.map(({ kind, id }) => ({ kind, id }));
  const sourcesChanged = Boolean(activeTopic && !sameSources(activeTopic.sources, draftSources));
  const goalChanged = Boolean(activeTopic && activeTopic.goal !== goal.trim());
  const mapInputsChanged = sourcesChanged || goalChanged;
  const savedMap = activeTopic?.map || null;
  const stableMap = activeTopic && !mapInputsChanged ? activeTopic.map : null;
  const currentSignature = draftSignature(title, goal, draftSources);
  const validPendingRevision = pendingRevision?.signature === currentSignature ? pendingRevision : null;
  const displayMap = validPendingRevision?.map || stableMap;
  const revisionDiff = validPendingRevision && savedMap ? compareLearningMaps(savedMap, validPendingRevision.map) : null;
  const activeNode = displayMap?.nodes.find((node) => node.id === activeNodeId) || displayMap?.nodes[0] || null;
  const visibleSources = sources.filter((source) => sourceFilter === "all" || source.kind === sourceFilter);
  const originalSourceCount = new Set(selectedSources.map((source) => source.originKey)).size;
  const savedSourceKeys = new Set(activeTopic?.sources.map(sourceKey) || []);
  const draftSourceKeys = new Set(draftSources.map(sourceKey));
  const addedSources = draftSources.filter((source) => !savedSourceKeys.has(sourceKey(source)));
  const removedSources = (activeTopic?.sources || []).filter((source) => !draftSourceKeys.has(sourceKey(source)));

  function sourceTitle(source: LearningSourceRef) {
    return sourceIndex.get(sourceKey(source))?.title || "已不可用的来源";
  }

  function selectTopic(topic: LearningTopic) {
    setDraftId(topic.id);
    setTitle(topic.title);
    setGoal(topic.goal);
    setSelectedKeys(topic.sources.map(sourceKey));
    setActiveNodeId(topic.map?.nodes[0]?.id || "");
    setAddedQuestionIds([]);
    setPendingRevision(null);
    setMessage(topic.map ? "已打开保存的证据脉络；选择节点可回查资料" : "资料架已保存，可以继续调整或生成脉络");
  }

  function startNew() {
    setDraftId(createTopicId());
    setTitle("");
    setGoal("");
    setSelectedKeys(sources.slice(0, 4).map(sourceKey));
    setActiveNodeId("");
    setAddedQuestionIds([]);
    setPendingRevision(null);
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
    setPendingRevision(null);
    setMessage(savedMap ? "资料发生变化；旧脉络仍保留，生成修订并确认后才会更新" : "资料架已更新，尚未写入本地专题");
  }

  function changeTitle(value: string) {
    setTitle(value.slice(0, 100));
    setPendingRevision(null);
  }

  function changeGoal(value: string) {
    setGoal(value.slice(0, 500));
    setActiveNodeId("");
    setPendingRevision(null);
    if (savedMap) setMessage("学习问题已变化；旧脉络仍保留，生成修订后再决定是否采用");
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
    if (validPendingRevision) {
      setMessage("新版脉络仍在审阅中；先采用或放弃，再保存其他修改");
      return;
    }
    if (savedMap && mapInputsChanged) {
      setMessage("来源或学习问题尚未写入；旧脉络不会被清空，请先生成并审阅修订");
      return;
    }
    onSave({ id: draftId, title: title.trim(), goal: goal.trim(), sources: draftSources, map: stableMap }, "human");
    setMessage(stableMap ? "专题与当前脉络已保存到本机" : "资料架已保存；现在可以让 Agent 编织脉络");
  }

  async function buildMap() {
    if (!validDraft()) return;
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；只会发送当前选择的摘要与知识卡内容");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setPendingRevision(null);
    setMessage(`正在核对 ${selectedSources.length} 条资料，分开共同结论、分歧和资料缺口…`);
    try {
      const revising = Boolean(activeTopic?.map);
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: revising ? "revise-learning-topic" : "build-learning-topic",
          baseURL,
          apiKey,
          model,
          title: title.trim(),
          goal: goal.trim(),
          sources: selectedSources.map(({ kind, id, title: sourceTitle, digest }) => ({ kind, id, title: sourceTitle, digest })),
          previousTopic: revising && activeTopic ? {
            title: activeTopic.title,
            goal: activeTopic.goal,
            sources: activeTopic.sources.map((source) => ({ ...source, title: sourceTitle(source) })),
            map: activeTopic.map,
          } : undefined,
        }),
      });
      const data = (await response.json()) as { error?: string; map?: LearningMap; revision?: TopicRevisionNote };
      if (!response.ok || !data.map) throw new Error(data.error || "模型没有返回学习脉络");
      setActiveNodeId(data.map.nodes[0]?.id || "");
      if (revising) {
        if (!data.revision) throw new Error("模型没有返回可审阅的修订说明");
        setPendingRevision({ signature: currentSignature, map: data.map, revision: data.revision });
        setMessage(`新版含 ${data.map.nodes.length} 个有据节点，尚未写入；核对差异后再采用`);
      } else {
        onSave({ id: draftId, title: title.trim(), goal: goal.trim(), sources: draftSources, map: data.map }, "agent");
        setMessage(`已保存 ${data.map.nodes.length} 个有据节点和 ${data.map.openQuestions.length} 个待求证问题`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "学习脉络生成失败");
    } finally {
      setBusy(false);
    }
  }

  function acceptRevision() {
    if (!validPendingRevision) return;
    onSave({ id: draftId, title: title.trim(), goal: goal.trim(), sources: draftSources, map: validPendingRevision.map }, "agent");
    setActiveNodeId(validPendingRevision.map.nodes[0]?.id || "");
    setPendingRevision(null);
    setAddedQuestionIds([]);
    setMessage("新版脉络已采用并保存；旧版在确认前从未被覆盖");
  }

  function discardRevision() {
    setPendingRevision(null);
    setActiveNodeId(savedMap?.nodes[0]?.id || "");
    setMessage("已放弃这份修订；本地保存的旧脉络保持不变");
  }

  function removeTopic() {
    if (!activeTopic || !window.confirm(`移除学习专题「${activeTopic.title}」？原视频和知识卡不会被删除。`)) return;
    onRemove(activeTopic.id);
    startNew();
    setMessage("专题已移除；原始视频和知识卡仍然保留");
  }

  function createQuestionTask(question: LearningMap["openQuestions"][number]) {
    if (validPendingRevision) {
      setMessage("这还是未采用的修订；先采用新版，再把开放问题加入任务");
      return;
    }
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
        <label><span>专题名称</span><input value={title} onChange={(event) => changeTitle(event.target.value)} placeholder="例如：怎样建立不依赖意志力的学习系统" /></label>
        <label><span>这次真正想弄清什么</span><textarea value={goal} onChange={(event) => changeGoal(event.target.value)} placeholder="写成一个具体问题：哪些方法相互支持，哪些只适用于特定情境？" /></label>
        <div><button className="topic-save" onClick={saveShelf}>保存资料架</button><button className="topic-weave" onClick={() => void buildMap()} disabled={busy}>{busy ? "正在编织…" : savedMap ? "生成可审阅修订 ✦" : "生成证据脉络 ✦"}</button>{activeTopic && <button className="topic-remove" onClick={removeTopic} aria-label="移除当前专题">移除</button>}</div>
      </div>

      {validPendingRevision && savedMap && revisionDiff && <section className="topic-revision-review">
        <header><div><span>MAP CHANGESET · 尚未写入</span><h2>先看变化，再决定要不要采用。</h2></div><strong>{revisionDiff.added.length + revisionDiff.changed.length + revisionDiff.removed.length + (revisionDiff.thesisChanged ? 1 : 0)} 处结构变化</strong></header>
        <div className="revision-source-delta">
          <div><span>资料变化</span>{addedSources.length || removedSources.length ? <p>{addedSources.map((source) => <i className="added" key={`added-${sourceKey(source)}`}>＋ {sourceTitle(source)}</i>)}{removedSources.map((source) => <i className="removed" key={`removed-${sourceKey(source)}`}>－ {sourceTitle(source)}</i>)}</p> : <p><i>资料集合未变化</i></p>}</div>
          <div><span>学习问题</span><p className={goalChanged ? "changed" : ""}>{goalChanged ? `旧：${activeTopic?.goal}　→　新：${goal.trim()}` : "学习问题未变化，本次只重新核对结构"}</p></div>
        </div>
        <div className="revision-thesis"><article><span>保存中的中心理解</span><p>{savedMap.thesis}</p></article><b>→</b><article><span>提议的新中心理解</span><p>{validPendingRevision.map.thesis}</p></article></div>
        <div className="revision-ledger">
          <article className="preserved"><header><span>保留</span><strong>{revisionDiff.preserved.length}</strong></header>{(validPendingRevision.revision.preserved.length ? validPendingRevision.revision.preserved : revisionDiff.preserved).map((item, index) => <p key={`preserved-${index}`}>＝ {item}</p>)}{!revisionDiff.preserved.length && !validPendingRevision.revision.preserved.length && <p>没有完全不变的节点</p>}</article>
          <article className="changed"><header><span>新增 / 改写</span><strong>{revisionDiff.added.length + revisionDiff.changed.length}</strong></header>{validPendingRevision.revision.changed.map((item, index) => <p key={`changed-${index}`}>＋ {item}</p>)}{!validPendingRevision.revision.changed.length && [...revisionDiff.added, ...revisionDiff.changed].map((item, index) => <p key={`changed-local-${index}`}>＋ {item}</p>)}{!revisionDiff.added.length && !revisionDiff.changed.length && !validPendingRevision.revision.changed.length && <p>没有新增或实质改写</p>}</article>
          <article className="removed"><header><span>移除</span><strong>{revisionDiff.removed.length}</strong></header>{validPendingRevision.revision.removed.map((item, index) => <p key={`removed-${index}`}>－ {item}</p>)}{!validPendingRevision.revision.removed.length && revisionDiff.removed.map((item, index) => <p key={`removed-local-${index}`}>－ {item}</p>)}{!revisionDiff.removed.length && !validPendingRevision.revision.removed.length && <p>没有移除旧节点</p>}</article>
        </div>
        <blockquote><span>修订摘要</span><p>{validPendingRevision.revision.summary}</p>{validPendingRevision.revision.caution && <small>仍需核对：{validPendingRevision.revision.caution}</small>}</blockquote>
        <footer><p><i />当前画布显示的是修订预览，旧脉络仍安全保存在本机。</p><div><button onClick={discardRevision}>放弃修订</button><button onClick={acceptRevision}>采用新版 <span>↗</span></button></div></footer>
      </section>}

      <div className="source-loom">
        <aside className="source-pins">
          <header><div><span>SOURCE PINS</span><strong>{selectedSources.length}/16 条已钉住</strong></div><nav><button className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>全部</button><button className={sourceFilter === "video" ? "active" : ""} onClick={() => setSourceFilter("video")}>视频</button><button className={sourceFilter === "knowledge" ? "active" : ""} onClick={() => setSourceFilter("knowledge")}>卡片</button></nav></header>
          <div>{visibleSources.map((source) => {
            const selected = selectedKeys.includes(sourceKey(source));
            return <button className={selected ? "selected" : ""} key={sourceKey(source)} onClick={() => toggleSource(source)} aria-pressed={selected}><i>{source.kind === "video" ? "V" : "K"}</i><span><strong>{source.title}</strong><small>{source.origin}</small></span><b>{selected ? "✓" : "+"}</b></button>;
          })}</div>
        </aside>

        <section className={`learning-map ${displayMap ? "has-map" : ""}`}>
          <header><span>UNDERSTANDING MAP</span><strong>{displayMap ? `${displayMap.nodes.length} 个节点 · ${displayMap.edges.length} 条关系${validPendingRevision ? " · 预览" : ""}` : "等待编织"}</strong></header>
          {displayMap ? <>
            <article className="map-thesis"><small>{validPendingRevision ? "修订预览 · 未保存" : "中心理解"}</small><h2>{displayMap.thesis}</h2><span>{selectedSources.length} 条资料共同限定</span></article>
            <div className="map-thread" aria-hidden="true"><i /><i /><i /></div>
            <div className="map-node-grid">{displayMap.nodes.map((node, index) => {
              const incoming = displayMap.edges.filter((edge) => edge.to === node.id);
              return <button className={`${node.kind} ${activeNode?.id === node.id ? "active" : ""}`} key={node.id} onClick={() => setActiveNodeId(node.id)}><small><i>{String(index + 1).padStart(2, "0")}</i>{nodeKindLabels[node.kind]} · {node.sourceRefs.length} 证据</small><strong>{node.title}</strong><p>{node.summary}</p>{incoming.length > 0 && <span>{incoming.map((edge) => relationLabels[edge.relation]).join(" · ")}</span>}</button>;
            })}</div>
            {displayMap.edges.length > 0 && <div className="map-relations"><span>关系索引</span>{displayMap.edges.map((edge, index) => {
              const from = displayMap.nodes.find((node) => node.id === edge.from);
              const to = displayMap.nodes.find((node) => node.id === edge.to);
              return <p key={`${edge.from}-${edge.to}-${index}`}><i>{relationLabels[edge.relation]}</i><strong>{from?.title}</strong><b>→</b><strong>{to?.title}</strong><small>{edge.label}</small></p>;
            })}</div>}
          </> : <div className="map-empty"><div><i /><i /><i /><span>⌘</span></div><strong>{savedMap && mapInputsChanged ? "旧脉络仍安全保留" : `${selectedSources.length} 条资料已经就位`}</strong><p>{savedMap && mapInputsChanged ? "来源或学习问题已经变化。新版只有在你看完差异并采用后，才会替换保存中的脉络。" : "Agent 只读取左侧选中的摘要和知识卡，不能调用外部常识。保存资料架不需要模型。"}</p><button onClick={() => void buildMap()} disabled={busy}>{busy ? "正在核对来源…" : savedMap ? "生成修订预览" : "编织第一张脉络"}</button></div>}
        </section>

        <aside className="topic-inspector">
          <header><span>TRACE / GAPS</span><strong>{activeNode ? "节点证据" : "待求证区"}</strong></header>
          {activeNode ? <section className="node-trace"><small>{nodeKindLabels[activeNode.kind]}</small><h3>{activeNode.title}</h3><p>{activeNode.summary}</p><div>{activeNode.sourceRefs.map((ref) => {
            const source = sourceIndex.get(sourceKey(ref));
            return <button key={sourceKey(ref)} onClick={ref.kind === "video" ? onOpenVideo : onOpenKnowledge}><i>{ref.kind === "video" ? "V" : "K"}</i><span><strong>{source?.title || "来源已不可用"}</strong><small>{source?.origin || "需要重新选择资料"}</small></span><b>↗</b></button>;
          })}</div></section> : <div className="trace-empty"><span>◎</span><p>生成脉络后，选择一个节点查看它究竟由哪些资料支持。</p></div>}
          <section className="open-questions"><div><span>OPEN QUESTIONS</span><strong>{displayMap?.openQuestions.length || 0}</strong></div>{displayMap?.openQuestions.length ? displayMap.openQuestions.map((question) => <article key={question.id}><i>?</i><strong>{question.question}</strong><p>{question.reason}</p><button disabled={Boolean(validPendingRevision) || addedQuestionIds.includes(question.id)} onClick={() => createQuestionTask(question)}>{validPendingRevision ? "采用新版后可加入" : addedQuestionIds.includes(question.id) ? "已加入今日任务" : "加入求证任务 ↗"}</button></article>) : <p>{displayMap ? "当前脉络没有单列资料缺口；仍应回看节点来源。" : "没有脉络时不会伪造开放问题。"}</p>}</section>
        </aside>
      </div>

      <p className="learning-message"><i className={busy ? "busy" : ""} />{message}</p>
    </section>
  );
}
