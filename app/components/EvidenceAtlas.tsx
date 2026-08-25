"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildEvidenceGraph, findEvidencePath } from "../features/workbench-core.mjs";
import type {
  EvidenceGraphEdge,
  EvidenceGraphNode,
  EvidenceGraphNodeKind,
  WorkbenchState,
} from "../features/workbench-core.mjs";

type EvidenceAtlasProps = {
  state: WorkbenchState;
  onOpenNode: (kind: EvidenceGraphNodeKind) => void;
  onOpenVideo: () => void;
  onCreateTask: (task: { title: string; note: string }) => void;
};

type KindFilter = "all" | EvidenceGraphNodeKind;
type PositionedNode = { node: EvidenceGraphNode; x: number; y: number; depth: 0 | 1 | 2 };

const kindLabels: Record<EvidenceGraphNodeKind, string> = {
  video: "视频",
  frame: "画面",
  knowledge: "知识",
  topic: "专题",
  study: "复习",
};

const kindMarks: Record<EvidenceGraphNodeKind, string> = {
  video: "V",
  frame: "F",
  knowledge: "K",
  topic: "T",
  study: "R",
};

const edgeLabels: Record<EvidenceGraphEdge["kind"], string> = {
  contains: "包含画面",
  distills: "提炼知识",
  grounds: "画面支撑",
  uses: "进入专题",
  reviews: "生成复习",
  relates: "跨来源关联",
};

const kindOrder: EvidenceGraphNodeKind[] = ["video", "frame", "knowledge", "topic", "study"];

function formatDate(value: string) {
  if (!value) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function neighborId(edge: EvidenceGraphEdge, nodeId: string) {
  return edge.from === nodeId ? edge.to : edge.from;
}

function positionNodes(center: EvidenceGraphNode, direct: EvidenceGraphNode[], second: EvidenceGraphNode[]): PositionedNode[] {
  const positioned: PositionedNode[] = [{ node: center, x: 410, y: 260, depth: 0 }];
  direct.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, direct.length);
    positioned.push({ node, x: 410 + Math.cos(angle) * 242, y: 260 + Math.sin(angle) * 148, depth: 1 });
  });
  second.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * (index + .35)) / Math.max(1, second.length);
    positioned.push({ node, x: 410 + Math.cos(angle) * 340, y: 260 + Math.sin(angle) * 214, depth: 2 });
  });
  return positioned;
}

export function EvidenceAtlas({ state, onOpenNode, onOpenVideo, onCreateTask }: EvidenceAtlasProps) {
  const graph = useMemo(() => buildEvidenceGraph(state), [state]);
  const nodeIndex = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const orphanIds = useMemo(() => new Set(graph.orphanNodeIds), [graph.orphanNodeIds]);
  const latestAnchor = graph.nodes.slice().reverse().find((node) => node.kind === "topic")
    || graph.nodes.slice().reverse().find((node) => node.kind === "study")
    || graph.nodes.at(-1)
    || null;
  const [activeId, setActiveId] = useState(latestAnchor?.id || "");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [taskedIds, setTaskedIds] = useState<string[]>([]);
  const mapScrollRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const candidateNodes = graph.nodes.filter((node) => {
    if (kindFilter !== "all" && node.kind !== kindFilter) return false;
    if (orphansOnly && !orphanIds.has(node.id)) return false;
    if (!normalizedQuery) return true;
    return `${node.title} ${node.detail} ${node.meta}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });
  const activeNode = candidateNodes.find((node) => node.id === activeId) || candidateNodes[0] || null;
  const activeEdges = activeNode ? graph.edges.filter((edge) => edge.from === activeNode.id || edge.to === activeNode.id) : [];
  const candidateIds = new Set(candidateNodes.map((node) => node.id));
  const directNodes = activeNode
    ? [...new Set(activeEdges.map((edge) => neighborId(edge, activeNode.id)))]
      .filter((id) => candidateIds.has(id))
      .map((id) => nodeIndex.get(id))
      .filter((node): node is EvidenceGraphNode => Boolean(node))
      .sort((left, right) => kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) || right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8)
    : [];
  const directIds = new Set(directNodes.map((node) => node.id));
  const secondNodes = activeNode
    ? graph.edges
      .filter((edge) => directIds.has(edge.from) || directIds.has(edge.to))
      .map((edge) => directIds.has(edge.from) ? edge.to : edge.from)
      .filter((id, index, list) => id !== activeNode.id && !directIds.has(id) && candidateIds.has(id) && list.indexOf(id) === index)
      .map((id) => nodeIndex.get(id))
      .filter((node): node is EvidenceGraphNode => Boolean(node))
      .slice(0, 6)
    : [];
  const positionedNodes = activeNode ? positionNodes(activeNode, directNodes, secondNodes) : [];
  const positionIndex = new Map(positionedNodes.map((item) => [item.node.id, item]));
  const visibleEdges = graph.edges.filter((edge) => positionIndex.has(edge.from) && positionIndex.has(edge.to));
  const edgeIndex = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const sourceCandidates = graph.nodes.filter((node) => node.kind === "frame" || node.kind === "video");
  const nearestSourcePath = activeNode
    ? sourceCandidates
      .map((source) => ({ source, path: findEvidencePath(graph, activeNode.id, source.id, 6) }))
      .filter((item): item is { source: EvidenceGraphNode; path: NonNullable<ReturnType<typeof findEvidencePath>> } => Boolean(item.path)
        && item.path!.edgeIds.every((id) => edgeIndex.get(id)?.kind !== "relates"))
      .sort((left, right) => left.path.nodeIds.length - right.path.nodeIds.length
        || (left.source.kind === "frame" ? 0 : 1) - (right.source.kind === "frame" ? 0 : 1)
        || left.source.id.localeCompare(right.source.id))[0]?.path || null
    : null;
  const traceNodes = nearestSourcePath ? nearestSourcePath.nodeIds.slice().reverse().map((id) => nodeIndex.get(id)).filter((node): node is EvidenceGraphNode => Boolean(node)) : [];
  const counts = Object.fromEntries(kindOrder.map((kind) => [kind, graph.nodes.filter((node) => node.kind === kind).length])) as Record<EvidenceGraphNodeKind, number>;
  const groundedRate = graph.nodes.length ? Math.round((graph.connectedNodeIds.length / graph.nodes.length) * 100) : 0;
  const activeNodeId = activeNode?.id || "";

  useEffect(() => {
    const container = mapScrollRef.current;
    if (!container) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNodeId, kindFilter, normalizedQuery]);

  function chooseKind(kind: KindFilter) {
    setKindFilter(kind);
    setOrphansOnly(false);
    const next = kind === "all" ? graph.nodes.find((node) => node.id === activeId) || graph.nodes[0] : graph.nodes.find((node) => node.kind === kind);
    if (next) setActiveId(next.id);
  }

  function showOrphans() {
    const next = graph.nodes.find((node) => orphanIds.has(node.id));
    setOrphansOnly((current) => !current);
    setKindFilter("all");
    if (next) setActiveId(next.id);
  }

  function createEvidenceTask() {
    if (!activeNode || taskedIds.includes(activeNode.id)) return;
    const missingSource = orphanIds.has(activeNode.id) || !nearestSourcePath;
    onCreateTask({
      title: `${missingSource ? "补齐" : "核对"}「${activeNode.title}」的证据链`,
      note: missingSource
        ? `来自证据星图 · 当前${kindLabels[activeNode.kind]}尚未连接到可回查的本地来源。`
        : `来自证据星图 · 沿 ${traceNodes.map((node) => node.title).join(" → ")} 回查。`,
    });
    setTaskedIds((current) => [...current, activeNode.id]);
  }

  if (!graph.nodes.length) {
    return (
      <section className="evidence-atlas atlas-empty">
        <p className="eyebrow">证据星图 · 本地关系层</p>
        <h1>先留下真实资料，<br /><em>关系才有出现的理由。</em></h1>
        <div><span>✦</span><section><strong>星图还是空的</strong><p>保存一个视频总结、知识卡、学习专题或复习卡后，这里会自动显示真实连接，不生成示例节点。</p><button onClick={onOpenVideo}>从视频资料开始 <b>↗</b></button></section></div>
      </section>
    );
  }

  return (
    <section className="evidence-atlas">
      <div className="workspace-heading atlas-heading">
        <div><p className="eyebrow">证据星图 · EVIDENCE CONSTELLATION</p><h1>看见理解怎样形成，<em>也看见哪里仍然悬空。</em></h1></div>
        <div className="atlas-stats"><span><strong>{graph.nodes.length}</strong> 节点</span><span><strong>{graph.edges.length}</strong> 关系</span><span><strong>{groundedRate}%</strong> 已连接</span></div>
      </div>

      <div className="atlas-controls">
        <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value.slice(0, 120))} placeholder="搜索标题、内容或标签" aria-label="搜索证据星图" /></label>
        <div>{(["all", ...kindOrder] as KindFilter[]).map((kind) => <button className={kindFilter === kind && !orphansOnly ? "active" : ""} key={kind} onClick={() => chooseKind(kind)}>{kind === "all" ? "全部" : kindLabels[kind]}<small>{kind === "all" ? graph.nodes.length : counts[kind]}</small></button>)}</div>
        <button className={orphansOnly ? "active orphan-toggle" : "orphan-toggle"} onClick={showOrphans}>悬空 <small>{graph.orphanNodeIds.length}</small></button>
      </div>

      {normalizedQuery && <div className="atlas-search-results"><span>搜索结果</span>{candidateNodes.slice(0, 6).map((node) => <button className={node.id === activeNode?.id ? "active" : ""} key={node.id} onClick={() => setActiveId(node.id)}><i>{kindMarks[node.kind]}</i>{node.title}</button>)}{!candidateNodes.length && <p>没有匹配节点；换一个标题、标签或内容关键词。</p>}</div>}

      {activeNode ? <div className="atlas-observatory">
        <section className="atlas-map-panel">
          <header><div><span>LOCAL NEIGHBORHOOD</span><strong>以当前节点为中心 · 最多展开两层</strong></div><div><i className="edge-solid" /> 直接证据 <i className="edge-dashed" /> 语义关联</div></header>
          <div className="atlas-map-scroll" ref={mapScrollRef}>
            <div className="atlas-canvas" role="group" aria-label={`以${activeNode.title}为中心的证据关系`}>
              <svg viewBox="0 0 820 520" preserveAspectRatio="none" aria-hidden="true">
                <circle className="atlas-orbit orbit-one" cx="410" cy="260" rx="242" ry="148" />
                <circle className="atlas-orbit orbit-two" cx="410" cy="260" rx="340" ry="214" />
                {visibleEdges.map((edge) => {
                  const from = positionIndex.get(edge.from);
                  const to = positionIndex.get(edge.to);
                  if (!from || !to) return null;
                  return <line className={`atlas-edge ${edge.kind}`} key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
                })}
              </svg>
              {positionedNodes.map(({ node, x, y, depth }) => <button
                className={`atlas-node ${node.kind} depth-${depth} ${node.id === activeNode.id ? "active" : ""} ${orphanIds.has(node.id) ? "orphan" : ""}`}
                key={node.id}
                style={{ left: `${(x / 820) * 100}%`, top: `${(y / 520) * 100}%` }}
                onClick={() => setActiveId(node.id)}
                title={node.title}
              ><i>{kindMarks[node.kind]}</i><span><small>{kindLabels[node.kind]}</small><strong>{node.title}</strong></span></button>)}
            </div>
          </div>
          <footer><span><i /> 实线来自明确标识引用</span><span><i /> 点线只表示跨来源文本关联</span><strong>{positionedNodes.length}/{candidateNodes.length} 当前可见</strong></footer>
        </section>

        <aside className="atlas-inspector">
          <header><span>TRACE LEDGER</span><strong>{orphanIds.has(activeNode.id) ? "来源悬空" : "关系可回查"}</strong></header>
          <article className={`atlas-active-card ${activeNode.kind}`}><i>{kindMarks[activeNode.kind]}</i><small>{kindLabels[activeNode.kind]} · {formatDate(activeNode.createdAt)}</small><h2>{activeNode.title}</h2><p>{activeNode.detail}</p><span>{activeNode.meta}</span></article>
          <section className="atlas-trace"><header><span>最近来源链</span><strong>{traceNodes.length ? `${traceNodes.length} 站` : "未连接"}</strong></header>{traceNodes.length ? <div>{traceNodes.map((node, index) => <button key={node.id} onClick={() => setActiveId(node.id)}><i>{kindMarks[node.kind]}</i><span><strong>{node.title}</strong><small>{index === 0 ? "可回查来源" : edgeLabels[graph.edges.find((edge) => edge.from === node.id && edge.to === traceNodes[index - 1]?.id || edge.to === node.id && edge.from === traceNodes[index - 1]?.id)?.kind || "relates"]}</small></span>{index < traceNodes.length - 1 && <b>→</b>}</button>)}</div> : <p>当前节点找不到通往已保存视频或画面的路径。它不会被伪装成已有依据。</p>}</section>
          <section className="atlas-relations"><header><span>直接关系</span><strong>{activeEdges.length}</strong></header><div>{activeEdges.slice(0, 10).map((edge) => {
            const neighbor = nodeIndex.get(neighborId(edge, activeNode.id));
            if (!neighbor) return null;
            return <button key={edge.id} onClick={() => setActiveId(neighbor.id)}><i className={edge.kind} /><span><strong>{neighbor.title}</strong><small>{edge.from === activeNode.id ? `${edge.label} →` : `← ${edge.label}`}</small></span><b>{kindMarks[neighbor.kind]}</b></button>;
          })}</div></section>
          <footer><button onClick={() => onOpenNode(activeNode.kind)}>打开{kindLabels[activeNode.kind]}模块 <span>↗</span></button><button disabled={taskedIds.includes(activeNode.id)} onClick={createEvidenceTask}>{taskedIds.includes(activeNode.id) ? "已加入今日任务" : orphanIds.has(activeNode.id) || !nearestSourcePath ? "加入补证任务" : "加入核对任务"}</button></footer>
        </aside>
      </div> : <div className="atlas-no-results"><span>⌕</span><strong>当前筛选没有节点</strong><p>取消“悬空”筛选，或者清除搜索关键词后继续浏览。</p><button onClick={() => { setQuery(""); setOrphansOnly(false); chooseKind("all"); }}>显示全部关系</button></div>}
    </section>
  );
}
