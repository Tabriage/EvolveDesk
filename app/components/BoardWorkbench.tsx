"use client";

import { FormEvent, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  PersonalBoard,
  PersonalBoardBlueprint,
  PersonalBoardField,
  PersonalBoardRecord,
  PersonalBoardValue,
  PersonalRoute,
  WorkTask,
} from "../features/workbench-core.mjs";

type BoardWorkbenchProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  boards: PersonalBoard[];
  routes: PersonalRoute[];
  tasks: WorkTask[];
  onNeedSettings: () => void;
  onOpenRoutes: () => void;
  onSave: (board: PersonalBoardBlueprint | PersonalBoard) => void;
  onAddRecord: (boardId: string, input: { title: string; statusId?: string; values?: Record<string, PersonalBoardValue> }) => void;
  onUpdateRecord: (boardId: string, recordId: string, input: { title?: string; statusId?: string; values?: Record<string, PersonalBoardValue> }) => void;
  onRemoveRecord: (boardId: string, recordId: string) => void;
  onCreateTask: (boardId: string, recordId: string) => void;
  onArchive: (boardId: string) => void;
};

const accentColors: Record<PersonalBoard["accent"], string> = {
  blue: "#3159f5",
  coral: "#ff6d5a",
  violet: "#7657d6",
  green: "#1f9d6a",
  amber: "#d39a2c",
};

const toneLabels: Record<PersonalBoard["statuses"][number]["tone"], string> = {
  blue: "蓝",
  coral: "珊瑚",
  violet: "紫",
  green: "绿",
  amber: "金",
  slate: "灰",
};

const fieldTypeLabels: Record<PersonalBoardField["type"], string> = {
  text: "文本",
  number: "数字",
  date: "日期",
  select: "单选",
  checkbox: "勾选",
};

const boardIdeas = [
  "做一个视频选题到发布复盘的内容流水线",
  "记录英语材料、练习次数和复习状态",
  "管理蛋糕订单、交付日期和收款状态",
];

function boardTemplate(kind: "content" | "learning" | "orders" | "blank"): PersonalBoardBlueprint {
  if (kind === "content") return {
    name: "内容创作台",
    purpose: "让每个选题从灵感进入制作，发布后留下真实复盘。",
    itemLabel: "选题",
    accent: "coral",
    defaultView: "board",
    reflection: "模板没有预设你的平台、发布日期或创作结果，保存前请按真实流程调整。",
    linkedRouteId: null,
    statuses: [
      { label: "灵感", tone: "slate", done: false },
      { label: "待制作", tone: "blue", done: false },
      { label: "制作中", tone: "violet", done: false },
      { label: "已发布", tone: "green", done: true },
    ],
    fields: [
      { name: "平台", type: "select", required: false, options: ["小红书", "B站", "抖音", "YouTube"] },
      { name: "内容形式", type: "select", required: false, options: ["视频", "图文", "直播"] },
      { name: "发布日期", type: "date", required: false, options: [] },
      { name: "复盘", type: "text", required: false, options: [] },
    ],
  };
  if (kind === "learning") return {
    name: "学习材料台",
    purpose: "记录正在学习的材料，并明确它下一次应该学习、练习还是复习。",
    itemLabel: "学习材料",
    accent: "blue",
    defaultView: "table",
    reflection: "模板没有假定你的水平、课程来源或学习成果，字段和状态需要你确认。",
    linkedRouteId: null,
    statuses: [
      { label: "待学习", tone: "slate", done: false },
      { label: "学习中", tone: "blue", done: false },
      { label: "待复习", tone: "amber", done: false },
      { label: "已掌握", tone: "green", done: true },
    ],
    fields: [
      { name: "来源", type: "text", required: false, options: [] },
      { name: "练习次数", type: "number", required: false, options: [] },
      { name: "复习日期", type: "date", required: false, options: [] },
      { name: "学习笔记", type: "text", required: false, options: [] },
    ],
  };
  if (kind === "orders") return {
    name: "订单进度台",
    purpose: "把客户订单从确认推进到交付，并看清日期、金额和收款状态。",
    itemLabel: "订单",
    accent: "amber",
    defaultView: "table",
    reflection: "模板不会创建客户、金额或交付日期；所有业务记录都需要你亲自填写。",
    linkedRouteId: null,
    statuses: [
      { label: "待确认", tone: "slate", done: false },
      { label: "制作中", tone: "blue", done: false },
      { label: "待交付", tone: "amber", done: false },
      { label: "已完成", tone: "green", done: true },
    ],
    fields: [
      { name: "客户", type: "text", required: true, options: [] },
      { name: "金额", type: "number", required: false, options: [] },
      { name: "交付日期", type: "date", required: true, options: [] },
      { name: "已收款", type: "checkbox", required: false, options: [] },
    ],
  };
  return {
    name: "",
    purpose: "",
    itemLabel: "记录",
    accent: "blue",
    defaultView: "board",
    reflection: "这是一个空白业务台，需要你定义对象、状态与字段。",
    linkedRouteId: null,
    statuses: [
      { label: "待处理", tone: "slate", done: false },
      { label: "已完成", tone: "green", done: true },
    ],
    fields: [{ name: "说明", type: "text", required: false, options: [] }],
  };
}

function editableBoard(board: PersonalBoard): PersonalBoardBlueprint {
  return {
    id: board.id,
    createdAt: board.createdAt,
    name: board.name,
    purpose: board.purpose,
    itemLabel: board.itemLabel,
    accent: board.accent,
    defaultView: board.defaultView,
    reflection: board.reflection,
    linkedRouteId: board.linkedRouteId,
    statuses: board.statuses.map((status) => ({ ...status })),
    fields: board.fields.map((field) => ({ ...field, options: [...field.options] })),
  };
}

function boardReady(draft: PersonalBoardBlueprint) {
  const statusNames = draft.statuses.map((status) => status.label.trim()).filter(Boolean);
  const fieldNames = draft.fields.map((field) => field.name.trim()).filter(Boolean);
  return draft.name.trim().length >= 2
    && draft.purpose.trim().length >= 10
    && draft.itemLabel.trim().length >= 1
    && draft.statuses.length >= 2
    && statusNames.length === draft.statuses.length
    && new Set(statusNames).size === statusNames.length
    && draft.statuses.some((status) => status.done)
    && draft.fields.length >= 1
    && fieldNames.length === draft.fields.length
    && new Set(fieldNames).size === fieldNames.length
    && draft.fields.every((field) => field.type !== "select" || field.options.filter(Boolean).length >= 2);
}

function valueLabel(field: PersonalBoardField, value: PersonalBoardValue | undefined) {
  if (field.type === "checkbox") return value ? "是" : "否";
  if (field.type === "number" && value === 0) return "—";
  return String(value || "—");
}

function recordReady(board: PersonalBoard, record: PersonalBoardRecord) {
  return record.title.trim() && board.fields.every((field) => {
    if (!field.required) return true;
    const value = record.values[field.id];
    return field.type === "checkbox" ? value === true : value !== "" && value !== 0 && value !== undefined;
  });
}

export function BoardWorkbench({
  baseURL,
  apiKey,
  model,
  boards,
  routes,
  tasks,
  onNeedSettings,
  onOpenRoutes,
  onSave,
  onAddRecord,
  onUpdateRecord,
  onRemoveRecord,
  onCreateTask,
  onArchive,
}: BoardWorkbenchProps) {
  const activeBoards = useMemo(() => boards.filter((board) => !board.archivedAt), [boards]);
  const activeRoutes = useMemo(() => routes.filter((route) => !route.archivedAt), [routes]);
  const [activeId, setActiveId] = useState(() => activeBoards.at(-1)?.id || "");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<PersonalBoardBlueprint | null>(null);
  const [recordDraft, setRecordDraft] = useState<PersonalBoardRecord | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "table">("board");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(activeBoards.length ? "选择一个业务台，继续推进真实记录" : "选择模板、自己配置，或让 Agent 先设计结构");
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const activeBoard = activeBoards.find((board) => board.id === activeId) || activeBoards.at(-1) || null;
  const filteredRecords = activeBoard?.records.filter((record) => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (!query) return true;
    return `${record.title} ${Object.values(record.values).join(" ")}`.toLocaleLowerCase("zh-CN").includes(query);
  }) || [];
  const doneCount = activeBoard?.records.filter((record) => activeBoard.statuses.find((status) => status.id === record.statusId)?.done).length || 0;
  const linkedRoute = activeBoard?.linkedRouteId ? activeRoutes.find((route) => route.id === activeBoard.linkedRouteId) || null : null;

  async function designBoard(event: FormEvent) {
    event.preventDefault();
    const request = prompt.trim();
    if (request.length < 4) {
      setMessage("再具体一点：你反复记录什么，它通常会经历哪些变化？");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型，或直接选择一个可编辑模板");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setMessage("业务台 Agent 正在设计对象、字段和状态流程…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "design-board",
          baseURL,
          apiKey,
          model,
          prompt: request,
          workspace: {
            boards: activeBoards.slice(-8).map(({ name, purpose, itemLabel }) => ({ name, purpose, itemLabel })),
            routes: activeRoutes.slice(-8).map(({ id, name, purpose }) => ({ id, name, purpose })),
          },
        }),
      });
      const data = (await response.json()) as { error?: string; board?: Omit<PersonalBoardBlueprint, "linkedRouteId"> };
      if (!response.ok || !data.board) throw new Error(data.error || "模型没有返回业务台结构");
      setDraft({ ...data.board, linkedRouteId: null });
      setPrompt("");
      setMessage("结构草案已生成；逐项编辑并确认后才会保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "业务台生成失败");
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!draft || !boardReady(draft)) {
      setMessage("请补齐名称、用途、唯一状态、完成状态和有效字段");
      return;
    }
    const editingId = draft.id;
    onSave(draft);
    setDraft(null);
    setActiveId(editingId || "");
    setView(draft.defaultView);
    setMessage(editingId ? "业务台结构已更新，已有记录会保留可匹配字段" : "业务台已保存；现在加入第一条真实记录");
  }

  function updateStatus(index: number, patch: Partial<PersonalBoardBlueprint["statuses"][number]>) {
    if (!draft) return;
    setDraft({ ...draft, statuses: draft.statuses.map((status, itemIndex) => itemIndex === index ? { ...status, ...patch } : status) });
  }

  function updateField(index: number, patch: Partial<PersonalBoardBlueprint["fields"][number]>) {
    if (!draft) return;
    setDraft({ ...draft, fields: draft.fields.map((field, itemIndex) => itemIndex === index ? { ...field, ...patch } : field) });
  }

  function moveStatus(index: number, direction: -1 | 1) {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.statuses.length) return;
    const statuses = [...draft.statuses];
    [statuses[index], statuses[target]] = [statuses[target], statuses[index]];
    setDraft({ ...draft, statuses });
  }

  function submitRecord(event: FormEvent) {
    event.preventDefault();
    if (!activeBoard || !newTitle.trim()) return;
    onAddRecord(activeBoard.id, { title: newTitle.trim(), statusId: activeBoard.statuses[0]?.id });
    setNewTitle("");
    setMessage(`已加入一条${activeBoard.itemLabel}，可以继续补充字段或推进状态`);
  }

  function setRecordValue(fieldId: string, value: PersonalBoardValue) {
    if (!recordDraft) return;
    setRecordDraft({ ...recordDraft, values: { ...recordDraft.values, [fieldId]: value } });
  }

  function saveRecord() {
    if (!activeBoard || !recordDraft || !recordReady(activeBoard, recordDraft)) return;
    onUpdateRecord(activeBoard.id, recordDraft.id, {
      title: recordDraft.title,
      statusId: recordDraft.statusId,
      values: recordDraft.values,
    });
    setRecordDraft(null);
    setDeleteArmed(false);
    setMessage(`已更新「${recordDraft.title}」`);
  }

  if (draft) {
    return (
      <section className="board-workbench board-schema-view">
        <header className="board-schema-head">
          <div><p className="eyebrow">业务台配置 · 保存前可编辑</p><h1>先定义你真正关心的对象，<em>再决定它怎样流动。</em></h1></div>
          <button onClick={() => { setDraft(null); setMessage("已关闭结构草案，没有改变工作台"); }}>关闭草案</button>
        </header>

        <div className="board-schema-grid">
          <aside>
            <label>业务台名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 40) })} placeholder="例如：内容创作台" /></label>
            <label>它解决什么问题<textarea value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value.slice(0, 360) })} /></label>
            <label>一条记录叫什么<input value={draft.itemLabel} onChange={(event) => setDraft({ ...draft, itemLabel: event.target.value.slice(0, 20) })} placeholder="例如：选题、订单" /></label>
            <label>连接个人路线<select value={draft.linkedRouteId || ""} onChange={(event) => setDraft({ ...draft, linkedRouteId: event.target.value || null })}><option value="">暂不连接</option>{activeRoutes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
            <div className="board-schema-choice"><span>默认视图</span><button className={draft.defaultView === "board" ? "active" : ""} onClick={() => setDraft({ ...draft, defaultView: "board" })}>状态看板</button><button className={draft.defaultView === "table" ? "active" : ""} onClick={() => setDraft({ ...draft, defaultView: "table" })}>字段表格</button></div>
            <div className="board-schema-accent"><span>识别颜色</span>{(Object.keys(accentColors) as PersonalBoard["accent"][]).map((accent) => <button key={accent} className={draft.accent === accent ? "active" : ""} aria-label={`选择${accent}业务台颜色`} style={{ background: accentColors[accent] }} onClick={() => setDraft({ ...draft, accent })} />)}</div>
            <div className="board-schema-reflection"><span>✦ Agent 自省</span><p>{draft.reflection}</p></div>
          </aside>

          <main className="board-schema-builder">
            <section>
              <header><div><span>状态轨道</span><strong>记录会从左向右经过这些状态</strong></div><button disabled={draft.statuses.length >= 6} onClick={() => setDraft({ ...draft, statuses: [...draft.statuses, { label: `状态 ${draft.statuses.length + 1}`, tone: "slate", done: false }] })}>＋ 状态</button></header>
              <div className="board-status-schema">
                {draft.statuses.map((status, index) => <article key={status.id || `status-${index}`}>
                  <i>{index + 1}</i>
                  <input aria-label={`状态 ${index + 1} 名称`} value={status.label} onChange={(event) => updateStatus(index, { label: event.target.value.slice(0, 20) })} />
                  <select aria-label={`${status.label || `状态 ${index + 1}`}颜色`} value={status.tone} onChange={(event) => updateStatus(index, { tone: event.target.value as PersonalBoard["statuses"][number]["tone"] })}>{Object.entries(toneLabels).map(([tone, label]) => <option value={tone} key={tone}>{label}</option>)}</select>
                  <label><input type="checkbox" checked={status.done} onChange={(event) => updateStatus(index, { done: event.target.checked })} /> 完成态</label>
                  <div><button disabled={index === 0} onClick={() => moveStatus(index, -1)}>←</button><button disabled={index === draft.statuses.length - 1} onClick={() => moveStatus(index, 1)}>→</button><button disabled={draft.statuses.length <= 2} onClick={() => setDraft({ ...draft, statuses: draft.statuses.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>
                </article>)}
              </div>
            </section>

            <section>
              <header><div><span>记录字段</span><strong>只保留会影响判断或推进的信息</strong></div><button disabled={draft.fields.length >= 6} onClick={() => setDraft({ ...draft, fields: [...draft.fields, { name: `字段 ${draft.fields.length + 1}`, type: "text", required: false, options: [] }] })}>＋ 字段</button></header>
              <div className="board-field-schema">
                {draft.fields.map((field, index) => <article key={field.id || `field-${index}`}>
                  <input aria-label={`字段 ${index + 1} 名称`} value={field.name} onChange={(event) => updateField(index, { name: event.target.value.slice(0, 30) })} />
                  <select aria-label={`${field.name || `字段 ${index + 1}`}类型`} value={field.type} onChange={(event) => { const type = event.target.value as PersonalBoardField["type"]; updateField(index, { type, options: type === "select" ? field.options : [] }); }}>{Object.entries(fieldTypeLabels).map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select>
                  <label><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} /> 必填</label>
                  {field.type === "select" ? <input aria-label={`${field.name}选项`} value={field.options.join("，")} onChange={(event) => updateField(index, { options: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 8) })} placeholder="选项一，选项二" /> : <span>{fieldTypeLabels[field.type]}字段</span>}
                  <button disabled={draft.fields.length <= 1} onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, itemIndex) => itemIndex !== index) })}>移除</button>
                </article>)}
              </div>
            </section>
          </main>
        </div>
        <footer className="board-schema-footer"><p><i />{boardReady(draft) ? "结构完整，确认后才写入本地工作台" : "检查重复状态、完成态、必填内容和单选选项"}</p><button disabled={!boardReady(draft)} onClick={saveDraft}>保存这个业务台 <span>↗</span></button></footer>
      </section>
    );
  }

  return (
    <section className="board-workbench">
      <div className="workspace-heading board-heading">
        <div><p className="eyebrow">个人业务台 · 对象与流程</p><h1>每个人记录的东西不同，<em>推进的方法也应该由自己定义。</em></h1></div>
        <button className="board-blank-button" onClick={() => setDraft(boardTemplate("blank"))}>＋ 从空白开始</button>
      </div>

      <form className="board-agent-composer" onSubmit={designBoard}>
        <div><span>✦ 业务台 Agent</span><textarea aria-label="描述想建立的个人业务台" value={prompt} onChange={(event) => setPrompt(event.target.value.slice(0, 1_200))} placeholder="例如：我要管理视频选题，经过灵感、制作和发布，并记录平台与复盘…" /></div>
        <button disabled={busy || prompt.trim().length < 4}>{busy ? "正在设计结构…" : "生成可编辑结构"}<b>↗</b></button>
      </form>
      <div className="board-idea-row">{boardIdeas.map((idea) => <button key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}</div>
      <div className="board-template-row"><span>直接用模板</span><button onClick={() => setDraft(boardTemplate("content"))}>内容创作</button><button onClick={() => setDraft(boardTemplate("learning"))}>学习进度</button><button onClick={() => setDraft(boardTemplate("orders"))}>订单管理</button></div>
      <p className="board-message"><i className={busy ? "busy" : ""} />{message}</p>

      {!activeBoards.length ? (
        <div className="board-empty-state">
          <div className="board-wall" aria-hidden="true"><i /><i /><i /><span>对象进入</span><b>状态流动</b></div>
          <section><strong>还没有个人业务台</strong><p>先选择一个接近真实场景的模板，再把字段和状态改成自己的。模板不会替你创建客户、金额、进度或成果。</p><button onClick={() => setDraft(boardTemplate("content"))}>从内容创作模板开始 <span>↗</span></button></section>
        </div>
      ) : activeBoard && (
        <div className="board-atlas" style={{ "--board-accent": accentColors[activeBoard.accent] } as CSSProperties}>
          <aside className="board-shelf">
            <header><span>我的业务台</span><strong>{activeBoards.length}/10</strong></header>
            {activeBoards.slice().reverse().map((board) => <button key={board.id} className={board.id === activeBoard.id ? "active" : ""} style={{ "--item-accent": accentColors[board.accent] } as CSSProperties} onClick={() => { setActiveId(board.id); setView(board.defaultView); setSearch(""); setRecordDraft(null); setArchiveArmed(false); }}><i /><span><small>{board.itemLabel} · {board.records.length} 条</small><strong>{board.name}</strong><p>{board.purpose}</p></span></button>)}
            <button className="new-board-shelf" onClick={() => setDraft(boardTemplate("blank"))}>＋ 新业务台</button>
          </aside>

          <main className="board-studio">
            <header className="board-studio-hero">
              <div><span>个人业务台 · {activeBoard.itemLabel}</span><h2>{activeBoard.name}</h2><p>{activeBoard.purpose}</p>{linkedRoute && <button className="board-route-link" onClick={onOpenRoutes}>⌁ 支持路线「{linkedRoute.name}」</button>}</div>
              <div className="board-studio-stats"><span><strong>{activeBoard.records.length}</strong>全部</span><span><strong>{activeBoard.records.length - doneCount}</strong>推进中</span><span><strong>{doneCount}</strong>已完成</span></div>
            </header>

            <div className="board-studio-controls">
              <form onSubmit={submitRecord}><input aria-label={`新增${activeBoard.itemLabel}`} value={newTitle} onChange={(event) => setNewTitle(event.target.value.slice(0, 120))} placeholder={`加入一条真实${activeBoard.itemLabel}…`} /><button disabled={!newTitle.trim()}>＋ 加入</button></form>
              <label><span>⌕</span><input aria-label="搜索业务记录" value={search} onChange={(event) => setSearch(event.target.value.slice(0, 120))} placeholder="搜索记录或字段" /></label>
              <div><button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>看板</button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>表格</button></div>
              <button onClick={() => setDraft(editableBoard(activeBoard))}>编辑结构</button>
              <button className={archiveArmed ? "armed" : ""} onClick={() => { if (archiveArmed) { onArchive(activeBoard.id); setActiveId(""); setArchiveArmed(false); setMessage("业务台已归档，已创建的今日任务仍然保留"); } else setArchiveArmed(true); }}>{archiveArmed ? "再次确认" : "归档"}</button>
            </div>

            {view === "board" ? (
              <div className="personal-kanban">
                {activeBoard.statuses.map((status, statusIndex) => {
                  const records = filteredRecords.filter((record) => record.statusId === status.id);
                  const nextStatus = activeBoard.statuses[statusIndex + 1];
                  return <section className={`kanban-lane tone-${status.tone}`} key={status.id}>
                    <header><i /><strong>{status.label}</strong><span>{records.length}</span></header>
                    <div>{records.map((record) => {
                      const linkedTask = record.linkedTaskId ? tasks.find((task) => task.id === record.linkedTaskId) : null;
                      const previewFields = activeBoard.fields.filter((field) => record.values[field.id] !== "" && record.values[field.id] !== 0 && record.values[field.id] !== false).slice(0, 2);
                      return <article key={record.id}>
                        <button className="kanban-card-main" onClick={() => { setRecordDraft({ ...record, values: { ...record.values } }); setDeleteArmed(false); }}><small>{activeBoard.itemLabel}</small><strong>{record.title}</strong>{previewFields.map((field) => <span key={field.id}><i>{field.name}</i>{valueLabel(field, record.values[field.id])}</span>)}</button>
                        <footer>{linkedTask ? <span className={linkedTask.done ? "done" : ""}>{linkedTask.done ? "任务已完成" : "已在今日任务"}</span> : <button onClick={() => onCreateTask(activeBoard.id, record.id)}>转为任务</button>}{nextStatus && <button onClick={() => onUpdateRecord(activeBoard.id, record.id, { statusId: nextStatus.id })}>推进 → {nextStatus.label}</button>}</footer>
                      </article>;
                    })}{!records.length && <div className="kanban-lane-empty">没有{search ? "匹配" : "处于这里"}的{activeBoard.itemLabel}</div>}</div>
                  </section>;
                })}
              </div>
            ) : (
              <div className="personal-table-wrap">
                <table className="personal-table"><thead><tr><th>{activeBoard.itemLabel}</th><th>状态</th>{activeBoard.fields.map((field) => <th key={field.id}>{field.name}</th>)}<th>行动</th></tr></thead><tbody>{filteredRecords.map((record) => {
                  const status = activeBoard.statuses.find((item) => item.id === record.statusId);
                  const linkedTask = record.linkedTaskId ? tasks.find((task) => task.id === record.linkedTaskId) : null;
                  return <tr key={record.id}><td><button onClick={() => { setRecordDraft({ ...record, values: { ...record.values } }); setDeleteArmed(false); }}>{record.title}</button></td><td><span className={`table-status tone-${status?.tone || "slate"}`}><i />{status?.label}</span></td>{activeBoard.fields.map((field) => <td key={field.id}>{valueLabel(field, record.values[field.id])}</td>)}<td><button disabled={Boolean(linkedTask)} onClick={() => onCreateTask(activeBoard.id, record.id)}>{linkedTask ? "已接入" : "转任务"}</button></td></tr>;
                })}</tbody></table>{!filteredRecords.length && <div className="personal-table-empty">还没有{search ? "匹配的" : "真实"}{activeBoard.itemLabel}</div>}</div>
            )}
          </main>
        </div>
      )}

      {activeBoard && recordDraft && (
        <div className="board-record-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRecordDraft(null); }}>
          <section className="board-record-editor" role="dialog" aria-modal="true" aria-label={`编辑${recordDraft.title}`}>
            <header><div><p className="eyebrow">编辑{activeBoard.itemLabel}</p><h2>{recordDraft.title}</h2></div><button aria-label="关闭记录编辑" onClick={() => setRecordDraft(null)}>×</button></header>
            <label>名称<input value={recordDraft.title} onChange={(event) => setRecordDraft({ ...recordDraft, title: event.target.value.slice(0, 120) })} /></label>
            <label>当前状态<select value={recordDraft.statusId} onChange={(event) => setRecordDraft({ ...recordDraft, statusId: event.target.value })}>{activeBoard.statuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label>
            <div className="board-record-fields">{activeBoard.fields.map((field) => <label key={field.id}>{field.name}{field.required && <i>必填</i>}{field.type === "checkbox" ? <input type="checkbox" checked={Boolean(recordDraft.values[field.id])} onChange={(event) => setRecordValue(field.id, event.target.checked)} /> : field.type === "select" ? <select value={String(recordDraft.values[field.id] || "")} onChange={(event) => setRecordValue(field.id, event.target.value)}><option value="">未选择</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={String(recordDraft.values[field.id] ?? "")} onInput={(event) => setRecordValue(field.id, field.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value)} />}</label>)}</div>
            <div className="board-record-task"><span>今日行动</span><button disabled={Boolean(recordDraft.linkedTaskId && tasks.some((task) => task.id === recordDraft.linkedTaskId))} onClick={() => { onCreateTask(activeBoard.id, recordDraft.id); setRecordDraft(null); setMessage(`已把「${recordDraft.title}」接入今日任务`); }}>{recordDraft.linkedTaskId && tasks.some((task) => task.id === recordDraft.linkedTaskId) ? "已接入今日任务" : "把这条记录转为任务"}</button></div>
            <footer><button className={deleteArmed ? "armed" : ""} onClick={() => { if (deleteArmed) { onRemoveRecord(activeBoard.id, recordDraft.id); setRecordDraft(null); setDeleteArmed(false); setMessage(`已移除「${recordDraft.title}」`); } else setDeleteArmed(true); }}>{deleteArmed ? "再次点击确认移除" : "移除记录"}</button><button disabled={!recordReady(activeBoard, recordDraft)} onClick={saveRecord}>保存更改 <span>↗</span></button></footer>
          </section>
        </div>
      )}
    </section>
  );
}
