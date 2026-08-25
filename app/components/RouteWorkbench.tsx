"use client";

import { FormEvent, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  Habit,
  PersonalRoute,
  PersonalRouteBlueprint,
  PersonalRoutePhase,
  WorkTask,
} from "../features/workbench-core.mjs";

type RouteWorkbenchProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  routes: PersonalRoute[];
  tasks: WorkTask[];
  habits: Habit[];
  onNeedSettings: () => void;
  onSave: (route: PersonalRouteBlueprint | PersonalRoute) => void;
  onActivate: (routeId: string, phaseId: string, actionId: string) => void;
  onCompletePhase: (routeId: string, phaseId: string) => void;
  onArchive: (routeId: string) => void;
};

const accentColors: Record<PersonalRoute["accent"], string> = {
  blue: "#3159f5",
  coral: "#ff6d5a",
  violet: "#7657d6",
  green: "#1f9d6a",
  amber: "#d39a2c",
};

const categoryLabels: Record<PersonalRoute["category"], string> = {
  create: "创作",
  learn: "学习",
  practice: "练习",
  manage: "管理",
};

const routeIdeas = [
  "建立一条稳定的视频创作路线，从选题走到发布复盘",
  "把英语听说训练拆成可以每天推进的阶段",
  "设计一条从零开始练习小提琴的个人路线",
];

function blankRoute(): PersonalRouteBlueprint {
  return {
    name: "",
    purpose: "",
    category: "practice",
    accent: "blue",
    cadence: "按自己的节奏持续推进",
    successMetric: "写下可以亲自观察的完成证据",
    reflection: "这是一份空白路线，需要你补充真实目标与完成标准。",
    phases: [{
      title: "起步阶段",
      outcome: "描述完成这一阶段后真正发生的变化",
      completionRule: "描述你会用什么证据确认阶段完成",
      actions: [{ title: "", note: "", mode: "task" }],
    }],
  };
}

function editableRoute(route: PersonalRoute): PersonalRouteBlueprint {
  return {
    id: route.id,
    createdAt: route.createdAt,
    name: route.name,
    purpose: route.purpose,
    category: route.category,
    accent: route.accent,
    cadence: route.cadence,
    successMetric: route.successMetric,
    reflection: route.reflection,
    phases: route.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      outcome: phase.outcome,
      completionRule: phase.completionRule,
      completedAt: phase.completedAt,
      actions: phase.actions.map((action) => ({ ...action })),
    })),
  };
}

function draftReady(draft: PersonalRouteBlueprint) {
  return draft.name.trim().length >= 2
    && draft.purpose.trim().length >= 10
    && draft.cadence.trim().length >= 2
    && draft.successMetric.trim().length >= 4
    && draft.phases.length > 0
    && draft.phases.every((phase) => phase.title.trim().length >= 2
      && phase.outcome.trim().length >= 4
      && phase.completionRule.trim().length >= 4
      && phase.actions.length > 0
      && phase.actions.every((action) => action.title.trim()));
}

export function RouteWorkbench({
  baseURL,
  apiKey,
  model,
  routes,
  tasks,
  habits,
  onNeedSettings,
  onSave,
  onActivate,
  onCompletePhase,
  onArchive,
}: RouteWorkbenchProps) {
  const activeRoutes = useMemo(() => routes.filter((route) => !route.archivedAt), [routes]);
  const [activeId, setActiveId] = useState(() => activeRoutes.at(-1)?.id || "");
  const [viewPhaseId, setViewPhaseId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<PersonalRouteBlueprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(activeRoutes.length ? "选择一条路线，继续当前阶段" : "描述一个长期方向，Agent 会先生成可编辑草案");
  const [archiveArmed, setArchiveArmed] = useState(false);

  const activeRoute = activeRoutes.find((route) => route.id === activeId) || activeRoutes.at(-1) || null;
  const currentPhase = activeRoute?.phases.find((phase) => !phase.completedAt) || null;
  const viewedPhase = activeRoute?.phases.find((phase) => phase.id === viewPhaseId) || currentPhase || activeRoute?.phases.at(-1) || null;
  const completedCount = activeRoute?.phases.filter((phase) => phase.completedAt).length || 0;

  async function designRoute(event: FormEvent) {
    event.preventDefault();
    const request = prompt.trim();
    if (request.length < 4) {
      setMessage("再具体一点：你想持续推进什么，最终希望看到什么变化？");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型，或创建一条空白路线自己填写");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setMessage("路线 Agent 正在拆分阶段、完成证据与可接入动作…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "design-route",
          baseURL,
          apiKey,
          model,
          prompt: request,
          workspace: {
            tasks: tasks.filter((task) => !task.done).slice(-12).map(({ title, note }) => ({ title, note })),
            habits: habits.slice(-10).map(({ name }) => ({ name })),
            routes: activeRoutes.slice(-8).map(({ name, purpose }) => ({ name, purpose })),
          },
        }),
      });
      const data = (await response.json()) as { error?: string; route?: PersonalRouteBlueprint };
      if (!response.ok || !data.route) throw new Error(data.error || "模型没有返回路线蓝图");
      setDraft(data.route);
      setPrompt("");
      setMessage("路线草案已生成；逐项编辑并确认后才会写入工作台");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "路线生成失败");
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!draft || !draftReady(draft)) {
      setMessage("请补齐路线名称、目标、阶段结果、完成标准和至少一个动作");
      return;
    }
    const editingId = draft.id;
    onSave(draft);
    setDraft(null);
    setActiveId(editingId || "");
    setMessage(editingId ? "路线配置已更新" : "路线已保存；先把当前阶段的一个动作接进今天");
  }

  function updatePhase(index: number, patch: Partial<PersonalRouteBlueprint["phases"][number]>) {
    if (!draft) return;
    setDraft({ ...draft, phases: draft.phases.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...patch } : phase) });
  }

  function updateAction(phaseIndex: number, actionIndex: number, patch: Partial<PersonalRouteBlueprint["phases"][number]["actions"][number]>) {
    if (!draft) return;
    const phase = draft.phases[phaseIndex];
    updatePhase(phaseIndex, { actions: phase.actions.map((action, index) => index === actionIndex ? { ...action, ...patch } : action) });
  }

  function addPhase() {
    if (!draft || draft.phases.length >= 6) return;
    setDraft({
      ...draft,
      phases: [...draft.phases, {
        title: `阶段 ${draft.phases.length + 1}`,
        outcome: "",
        completionRule: "",
        actions: [{ title: "", note: "", mode: "task" }],
      }],
    });
  }

  function movePhase(index: number, direction: -1 | 1) {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.phases.length) return;
    const phases = [...draft.phases];
    [phases[index], phases[target]] = [phases[target], phases[index]];
    setDraft({ ...draft, phases });
  }

  function removePhase(index: number) {
    if (!draft || draft.phases.length <= 1) return;
    setDraft({ ...draft, phases: draft.phases.filter((_, phaseIndex) => phaseIndex !== index) });
  }

  function actionState(phase: PersonalRoutePhase, actionIndex: number) {
    const action = phase.actions[actionIndex];
    const linkedTask = action.linkedTaskId ? tasks.find((task) => task.id === action.linkedTaskId) : null;
    const linkedHabit = action.linkedHabitId ? habits.find((habit) => habit.id === action.linkedHabitId) : null;
    if (linkedTask) return { linked: true, done: linkedTask.done, label: linkedTask.done ? "任务已完成" : "已在今日任务" };
    if (linkedHabit) return { linked: true, done: false, label: "习惯已建立" };
    return { linked: false, done: false, label: action.mode === "habit" ? "建立习惯" : "加入今日任务" };
  }

  if (draft) {
    return (
      <section className="route-workbench route-editor-view">
        <header className="route-editor-head">
          <div><p className="eyebrow">路线配置 · 保存前可编辑</p><h1>不是接受一份计划，<em>而是把它改成你的。</em></h1></div>
          <button onClick={() => { setDraft(null); setMessage("已关闭草案，没有改变工作台"); }}>关闭草案</button>
        </header>

        <div className="route-editor-grid">
          <aside>
            <label>路线名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 40) })} placeholder="例如：每周稳定发布" /></label>
            <label>为什么要走这条路线<textarea value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value.slice(0, 360) })} /></label>
            <label>推进节奏<input value={draft.cadence} onChange={(event) => setDraft({ ...draft, cadence: event.target.value.slice(0, 100) })} /></label>
            <label>最终完成证据<textarea value={draft.successMetric} onChange={(event) => setDraft({ ...draft, successMetric: event.target.value.slice(0, 220) })} /></label>
            <div className="route-choice-row"><span>类型</span>{(Object.keys(categoryLabels) as PersonalRoute["category"][]).map((category) => <button className={draft.category === category ? "active" : ""} key={category} onClick={() => setDraft({ ...draft, category })}>{categoryLabels[category]}</button>)}</div>
            <div className="route-accent-row"><span>路线颜色</span>{(Object.keys(accentColors) as PersonalRoute["accent"][]).map((accent) => <button className={draft.accent === accent ? "active" : ""} style={{ background: accentColors[accent] }} aria-label={`选择${accent}路线颜色`} key={accent} onClick={() => setDraft({ ...draft, accent })} />)}</div>
            <div className="route-draft-reflection"><span>✦ Agent 自省</span><p>{draft.reflection}</p></div>
          </aside>

          <main className="route-phase-editor">
            <header><div><span>阶段顺序</span><strong>{draft.phases.length}/6 个阶段</strong></div><button onClick={addPhase} disabled={draft.phases.length >= 6}>＋ 添加阶段</button></header>
            {draft.phases.map((phase, phaseIndex) => (
              <article key={phase.id || `phase-${phaseIndex}`}>
                <header><i>{String(phaseIndex + 1).padStart(2, "0")}</i><div><button onClick={() => movePhase(phaseIndex, -1)} disabled={phaseIndex === 0}>↑</button><button onClick={() => movePhase(phaseIndex, 1)} disabled={phaseIndex === draft.phases.length - 1}>↓</button><button onClick={() => removePhase(phaseIndex)} disabled={draft.phases.length <= 1}>移除</button></div></header>
                <label>阶段名称<input value={phase.title} onChange={(event) => updatePhase(phaseIndex, { title: event.target.value.slice(0, 80) })} /></label>
                <label>阶段结果<textarea value={phase.outcome} onChange={(event) => updatePhase(phaseIndex, { outcome: event.target.value.slice(0, 260) })} /></label>
                <label>怎样确认完成<textarea value={phase.completionRule} onChange={(event) => updatePhase(phaseIndex, { completionRule: event.target.value.slice(0, 220) })} /></label>
                <div className="route-action-editor">
                  <span>可接入动作</span>
                  {phase.actions.map((action, actionIndex) => (
                    <div key={action.id || `action-${actionIndex}`}>
                      <select value={action.mode} onChange={(event) => updateAction(phaseIndex, actionIndex, { mode: event.target.value as "task" | "habit" })}><option value="task">一次任务</option><option value="habit">重复习惯</option></select>
                      <input value={action.title} onChange={(event) => updateAction(phaseIndex, actionIndex, { title: event.target.value.slice(0, 120) })} placeholder="动作名称" />
                      <input value={action.note} onChange={(event) => updateAction(phaseIndex, actionIndex, { note: event.target.value.slice(0, 320) })} placeholder="为什么做 / 做到什么程度" />
                      <button onClick={() => updatePhase(phaseIndex, { actions: phase.actions.filter((_, index) => index !== actionIndex) })} disabled={phase.actions.length <= 1} aria-label={`移除${action.title || "空白动作"}`}>×</button>
                    </div>
                  ))}
                  <button className="add-route-action" onClick={() => updatePhase(phaseIndex, { actions: [...phase.actions, { title: "", note: "", mode: "task" }] })} disabled={phase.actions.length >= 5}>＋ 添加动作</button>
                </div>
              </article>
            ))}
          </main>
        </div>
        <footer className="route-editor-footer"><p><i />{draftReady(draft) ? "配置完整，确认后写入本地工作台" : "仍有必填内容没有完成"}</p><button onClick={saveDraft} disabled={!draftReady(draft)}>保存这条路线 <span>↗</span></button></footer>
      </section>
    );
  }

  return (
    <section className="route-workbench">
      <div className="workspace-heading route-heading">
        <div><p className="eyebrow">我的路线 · 可配置模块</p><h1>长期目标不是一张清单，<em>而是一条会留下脚印的路。</em></h1></div>
        <button className="blank-route-button" onClick={() => setDraft(blankRoute())}>＋ 创建空白路线</button>
      </div>

      <form className="route-agent-composer" onSubmit={designRoute}>
        <div><span>✦ 路线 Agent</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 1_200))} placeholder="例如：我想稳定做视频内容，但总停在收集灵感，没有走到发布和复盘…" aria-label="描述想建立的个人路线" /></div>
        <button disabled={busy || prompt.trim().length < 4}>{busy ? "正在设计路线…" : "生成可编辑草案"}<b>↗</b></button>
      </form>
      <div className="route-idea-row">{routeIdeas.map((idea) => <button key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}</div>
      <p className="route-message"><i className={busy ? "busy" : ""} />{message}</p>

      {!activeRoutes.length ? (
        <div className="route-empty-state">
          <div className="route-compass" aria-hidden="true"><i /><i /><span>起点</span></div>
          <section><strong>还没有属于你的路线</strong><p>说出一个想长期推进的方向。Agent 只生成可编辑蓝图，不会替你虚构进度、日期或已有能力。</p><button onClick={() => setDraft(blankRoute())}>不用模型，自己配置 <span>↗</span></button></section>
        </div>
      ) : activeRoute && (
        <div className="route-atlas" style={{ "--route-accent": accentColors[activeRoute.accent] } as CSSProperties}>
          <aside className="route-shelf">
            <header><span>路线册</span><strong>{activeRoutes.length} 条进行中</strong></header>
            {activeRoutes.slice().reverse().map((route) => {
              const done = route.phases.filter((phase) => phase.completedAt).length;
              return <button className={route.id === activeRoute.id ? "active" : ""} key={route.id} onClick={() => { setActiveId(route.id); setViewPhaseId(""); setArchiveArmed(false); }} style={{ "--item-accent": accentColors[route.accent] } as CSSProperties}><i /><span><small>{categoryLabels[route.category]} · {done}/{route.phases.length} 阶段</small><strong>{route.name}</strong><p>{route.purpose}</p></span></button>;
            })}
            <button className="new-route-shelf" onClick={() => setDraft(blankRoute())}>＋ 新路线</button>
          </aside>

          <main className="route-map">
            <header className="route-map-hero">
              <div><span>{categoryLabels[activeRoute.category]}路线 · {activeRoute.cadence}</span><h2>{activeRoute.name}</h2><p>{activeRoute.purpose}</p></div>
              <div className="route-map-actions"><button onClick={() => setDraft(editableRoute(activeRoute))}>编辑配置</button><button className={archiveArmed ? "armed" : ""} onClick={() => { if (archiveArmed) { onArchive(activeRoute.id); setActiveId(""); setViewPhaseId(""); setArchiveArmed(false); setMessage("路线已归档，相关任务和习惯仍然保留"); } else setArchiveArmed(true); }}>{archiveArmed ? "再次点击确认归档" : "归档"}</button></div>
            </header>

            <div className="route-spine" aria-label={`${activeRoute.name}的阶段路线`}>
              {activeRoute.phases.map((phase, index) => {
                const completed = Boolean(phase.completedAt);
                const current = phase.id === currentPhase?.id;
                return <button className={completed ? "completed" : current ? "current" : "future"} key={phase.id} onClick={() => setViewPhaseId(phase.id)} aria-pressed={viewedPhase?.id === phase.id}><i>{completed ? "✓" : index + 1}</i><span><strong>{phase.title}</strong><small>{completed ? "已完成" : current ? "正在经过" : "等待前序阶段"}</small></span></button>;
              })}
              <b style={{ width: `${activeRoute.phases.length ? Math.round((completedCount / activeRoute.phases.length) * 100) : 0}%` }} />
            </div>

            {viewedPhase && (
              <article className={`route-phase-sheet ${viewedPhase.id === currentPhase?.id ? "current" : ""}`}>
                <header><div><span>{viewedPhase.completedAt ? "已完成阶段" : viewedPhase.id === currentPhase?.id ? "当前阶段" : "后续阶段"}</span><h3>{viewedPhase.title}</h3><p>{viewedPhase.outcome}</p></div><i>{String(activeRoute.phases.findIndex((phase) => phase.id === viewedPhase.id) + 1).padStart(2, "0")}</i></header>
                <div className="route-completion-rule"><span>完成标准</span><p>{viewedPhase.completionRule}</p></div>
                <div className="route-action-list">
                  {viewedPhase.actions.map((action, index) => {
                    const state = actionState(viewedPhase, index);
                    const canActivate = viewedPhase.id === currentPhase?.id && !state.linked;
                    return <div className={state.done ? "done" : state.linked ? "linked" : ""} key={action.id}><i>{action.mode === "habit" ? "↺" : "→"}</i><span><small>{action.mode === "habit" ? "重复习惯" : "一次任务"}</small><strong>{action.title}</strong><p>{action.note || "没有补充说明"}</p></span><button disabled={!canActivate} onClick={() => { onActivate(activeRoute.id, viewedPhase.id, action.id); setMessage(`已把「${action.title}」接入${action.mode === "habit" ? "习惯" : "今日任务"}`); }}>{state.label}</button></div>;
                  })}
                </div>
                <footer><p><span>终点证据</span>{activeRoute.successMetric}</p>{viewedPhase.id === currentPhase?.id && <button onClick={() => { onCompletePhase(activeRoute.id, viewedPhase.id); setViewPhaseId(""); setMessage(`已确认完成「${viewedPhase.title}」；路线进入下一阶段`); }} disabled={!viewedPhase.actions.some((action) => action.linkedTaskId || action.linkedHabitId)}>确认完成当前阶段 <b>↗</b></button>}</footer>
              </article>
            )}

            {!currentPhase && <div className="route-finished"><span>✓</span><div><strong>这条路线已经走完</strong><p>所有阶段都由你明确确认完成。可以保留作为记忆，或编辑后开始下一轮。</p></div></div>}
          </main>
        </div>
      )}
    </section>
  );
}
