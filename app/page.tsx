"use client";

import { FormEvent, useEffect, useState } from "react";
import { BoardWorkbench } from "./components/BoardWorkbench";
import { CreatorStudio } from "./components/CreatorStudio";
import { DataVault } from "./components/DataVault";
import { EvidenceAtlas } from "./components/EvidenceAtlas";
import { EvolutionLab } from "./components/EvolutionLab";
import { KnowledgeWorkbench } from "./components/KnowledgeWorkbench";
import { LearningTopicStudio } from "./components/LearningTopicStudio";
import { QuickStart } from "./components/QuickStart";
import { RouteWorkbench } from "./components/RouteWorkbench";
import { StudyStudio } from "./components/StudyStudio";
import { VideoWorkbench } from "./components/VideoWorkbench";
import { WeeklyReview } from "./components/WeeklyReview";
import { WorkAgent } from "./components/WorkAgent";
import {
  WORKBENCH_STORAGE_KEY,
  activateRouteAction,
  addCreatorIdeaToBoard,
  addCreatorSignal,
  addBoardRecord,
  addInboxItem,
  addTask,
  applyAgentActions,
  archivePersonalBoard,
  archivePersonalRoute,
  completeRoutePhase,
  createBoardRecordTask,
  createCreatorIdeaTask,
  createInitialWorkbench,
  createStudyReviewTask,
  getDueStudyCards,
  getTodayKey,
  parseWorkbenchState,
  removeCreatorIdea,
  removeCreatorReview,
  removeCreatorSignal,
  removeLearningTopic,
  removeStudyCard,
  removeBoardRecord,
  saveKnowledgeInquiry,
  saveLearningTopic,
  saveStudyCards,
  saveCreatorIdea,
  saveCreatorProfile,
  saveCreatorReview,
  savePersonalBoard,
  savePersonalRoute,
  saveWeeklyReview,
  saveVideoSummary,
  updateBoardRecord,
  updateCreatorIdea,
  rateStudyCard,
  toggleStudyCardSuspended,
} from "./features/workbench-core.mjs";
import type {
  Activity,
  AgentAction,
  WorkbenchState,
} from "./features/workbench-core.mjs";

type ActiveView = "today" | "routes" | "boards" | "creator" | "inbox" | "video" | "knowledge" | "topics" | "graph" | "study" | "review" | "memory" | "vault" | "lab";

type WorkPlan = {
  title: string;
  summary: string;
  reflection: string;
  risk: "low" | "medium" | "high";
  actions: AgentAction[];
};

function newActivity(label: string, detail: string, source: Activity["source"] = "human"): Activity {
  return {
    id: `activity-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
    label,
    detail,
    source,
    createdAt: new Date().toISOString(),
  };
}

function appendActivity(state: WorkbenchState, entry: Activity): WorkbenchState {
  return { ...state, activity: [...state.activity, entry].slice(-80) };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isSupportedVideoLink(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["youtube.com", "youtu.be", "bilibili.com", "b23.tv", "xiaohongshu.com", "xhslink.com", "douyin.com", "v.douyin.com"]
      .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export default function Home() {
  const [activeView, setActiveView] = useState<ActiveView>("today");
  const [desk, setDesk] = useState<WorkbenchState>(() => createInitialWorkbench());
  const [hydrated, setHydrated] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [captureInput, setCaptureInput] = useState("");
  const [habitInput, setHabitInput] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [starterOpen, setStarterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseURL, setBaseURL] = useState("http://localhost:62783/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("尚未连接模型");
  const [dateLabel, setDateLabel] = useState("本地日期");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDesk(parseWorkbenchState(window.localStorage.getItem(WORKBENCH_STORAGE_KEY)));
      const savedSettings = window.localStorage.getItem("evolve-desk.connection");
      if (savedSettings) {
        try {
          const settings = JSON.parse(savedSettings);
          setBaseURL(settings.baseURL || "http://localhost:62783/v1");
          setModel(settings.model || "");
        } catch {
          window.localStorage.removeItem("evolve-desk.connection");
        }
      }
      if (window.localStorage.getItem("evolve-desk.onboarding.v2") !== "complete") setStarterOpen(true);
      setDateLabel(new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()));
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(desk));
  }, [desk, hydrated]);

  const todayKey = getTodayKey();
  const openTasks = desk.tasks.filter((task) => !task.done);
  const completedTasks = desk.tasks.filter((task) => task.done);
  const newInbox = desk.inbox.filter((item) => item.status === "new");
  const focusTask = desk.tasks.find((task) => task.id === desk.focusTaskId && !task.done) || openTasks[0] || null;
  const habitsDone = desk.habits.filter((habit) => habit.completedDates.includes(todayKey)).length;
  const activeRoutes = desk.routes.filter((route) => !route.archivedAt);
  const activeBoards = desk.boards.filter((board) => !board.archivedAt);
  const dueStudyCards = getDueStudyCards(desk);
  function finishOnboarding() {
    window.localStorage.setItem("evolve-desk.onboarding.v2", "complete");
    setStarterOpen(false);
  }

  function createTask(title: string, source: "manual" | "inbox" | "agent" = "manual", note = "") {
    setDesk((current) => {
      const next = addTask(current, { title, note, source });
      if (next === current) return current;
      const label = source === "inbox" ? "从收件箱生成任务" : source === "agent" ? "由 Agent 加入任务" : "添加今日任务";
      return appendActivity(next, newActivity(label, title, source === "agent" ? "agent" : "human"));
    });
  }

  function submitTask(event: FormEvent) {
    event.preventDefault();
    const title = taskInput.trim();
    if (!title) return;
    createTask(title);
    setTaskInput("");
  }

  function saveCapture(event?: FormEvent) {
    event?.preventDefault();
    const content = captureInput.trim();
    if (!content) return;
    setDesk((current) => addInboxItem(current, content));
    setCaptureInput("");
  }

  function toggleTask(id: string) {
    setDesk((current) => {
      let completedTitle = "";
      const tasks = current.tasks.map((task) => {
        if (task.id !== id) return task;
        const done = !task.done;
        if (done) completedTitle = task.title;
        return { ...task, done, completedAt: done ? new Date().toISOString() : null };
      });
      const next = { ...current, tasks };
      return completedTitle ? appendActivity(next, newActivity("完成一项任务", completedTitle)) : next;
    });
  }

  function removeTask(id: string) {
    setDesk((current) => ({
      ...current,
      focusTaskId: current.focusTaskId === id ? null : current.focusTaskId,
      tasks: current.tasks.filter((task) => task.id !== id),
    }));
  }

  function setFocus(id: string) {
    setDesk((current) => {
      const task = current.tasks.find((item) => item.id === id);
      if (!task) return current;
      return appendActivity({ ...current, focusTaskId: id }, newActivity("更新今日焦点", task.title));
    });
  }

  function addHabit(event: FormEvent) {
    event.preventDefault();
    const name = habitInput.trim().slice(0, 50);
    if (!name) return;
    setDesk((current) => {
      if (current.habits.length >= 12 || current.habits.some((habit) => habit.name === name)) return current;
      const habit = { id: `habit-${globalThis.crypto?.randomUUID?.() || Date.now()}`, name, completedDates: [] as string[] };
      return appendActivity({ ...current, habits: [...current.habits, habit] }, newActivity("增加一个轻量习惯", name));
    });
    setHabitInput("");
  }

  function toggleHabit(id: string) {
    setDesk((current) => {
      let checkedName = "";
      const habits = current.habits.map((habit) => {
        if (habit.id !== id) return habit;
        const checked = habit.completedDates.includes(todayKey);
        if (!checked) checkedName = habit.name;
        return {
          ...habit,
          completedDates: checked
            ? habit.completedDates.filter((date) => date !== todayKey)
            : [...habit.completedDates, todayKey].slice(-90),
        };
      });
      const next = { ...current, habits };
      return checkedName ? appendActivity(next, newActivity("完成今日习惯", checkedName)) : next;
    });
  }

  function convertInboxItem(id: string) {
    setDesk((current) => {
      const item = current.inbox.find((entry) => entry.id === id);
      if (!item) return current;
      const title = item.kind === "link" ? "处理收件箱链接" : item.content;
      const next = addTask(current, { title, note: item.kind === "link" ? item.content : "", source: "inbox" });
      return appendActivity({
        ...next,
        inbox: next.inbox.map((entry) => entry.id === id ? { ...entry, status: "planned" as const } : entry),
      }, newActivity("从收件箱生成任务", title));
    });
  }

  function deleteInboxItem(id: string) {
    setDesk((current) => ({ ...current, inbox: current.inbox.filter((item) => item.id !== id) }));
  }

  function openVideo(url: string) {
    setVideoUrl(url);
    setActiveView("video");
  }

  function applyWorkPlan(plan: WorkPlan) {
    setDesk((current) => applyAgentActions(current, plan.actions, plan.title));
  }

  function restoreWorkbench(value: WorkbenchState) {
    const next = parseWorkbenchState(JSON.stringify(value));
    window.localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(next));
    setDesk(next);
  }

  async function connect() {
    if (!apiKey.trim()) {
      setConnectionMessage("请先输入密钥；它只保留在当前页面内存中");
      return;
    }
    setConnectionMessage("正在询问本地模型…");
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
      setSettingsOpen(false);
      setConnectionMessage(`本地模型在线 · ${data.models.length} 个模型`);
      window.localStorage.setItem("evolve-desk.connection", JSON.stringify({ baseURL, model: selected }));
    } catch (error) {
      setConnected(false);
      setConnectionMessage(error instanceof Error ? error.message : "无法连接本地模型");
    }
  }

  return (
    <main className={`app-shell ${activeView === "topics" ? "topic-mode" : activeView === "graph" ? "graph-mode" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setActiveView("today")}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Evolve Desk</strong><small>会和你一起长大的工作台</small></span>
        </button>
        <div className="top-actions">
          <span className={`connection ${connected ? "is-online" : ""}`}><i /> {connectionMessage}</span>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="打开连接设置">⌘</button>
          <div className="avatar">岚</div>
        </div>
      </header>

      <aside className="rail" aria-label="工作台导航">
        <button className={activeView === "today" ? "active" : ""} onClick={() => setActiveView("today")}><span>◫</span> 今日</button>
        <button className={activeView === "routes" ? "active" : ""} onClick={() => setActiveView("routes")}><span>⌁</span> 我的路线<small>{activeRoutes.length}</small></button>
        <button className={activeView === "boards" ? "active" : ""} onClick={() => setActiveView("boards")}><span>▦</span> 个人业务台<small>{activeBoards.length}</small></button>
        <button className={activeView === "creator" ? "active" : ""} onClick={() => setActiveView("creator")}><span>◒</span> 创作工作室<small>{desk.creator.ideas.length}</small></button>
        <button className={activeView === "inbox" ? "active" : ""} onClick={() => setActiveView("inbox")}><span>↘</span> 收件箱<small>{newInbox.length}</small></button>
        <button className={activeView === "video" ? "active" : ""} onClick={() => setActiveView("video")}><span>▷</span> 视频总结<small>{desk.videos.length}</small></button>
        <button className={activeView === "knowledge" ? "active" : ""} onClick={() => setActiveView("knowledge")}><span>◇</span> 知识库<small>{desk.knowledge.length}</small></button>
        <button className={activeView === "topics" ? "active" : ""} onClick={() => setActiveView("topics")}><span>⌘</span> 学习专题<small>{desk.learningTopics.length}</small></button>
        <button className={activeView === "graph" ? "active" : ""} onClick={() => setActiveView("graph")}><span>✦</span> 证据星图<small>{desk.knowledge.length + desk.learningTopics.length}</small></button>
        <button className={activeView === "study" ? "active" : ""} onClick={() => setActiveView("study")}><span>◈</span> 记忆复习<small>{dueStudyCards.length}</small></button>
        <button className={activeView === "review" ? "active" : ""} onClick={() => setActiveView("review")}><span>↺</span> 周回顾<small>{desk.weeklyReviews.length}</small></button>
        <button className={activeView === "memory" ? "active" : ""} onClick={() => setActiveView("memory")}><span>◎</span> 自省记忆</button>
        <button className={activeView === "vault" ? "active" : ""} onClick={() => setActiveView("vault")}><span>⇄</span> 数据迁移</button>
        <button className={activeView === "lab" ? "active" : ""} onClick={() => setActiveView("lab")}><span>⌘</span> 进化实验室</button>
        <div className="rail-label">能力底座</div>
        <div className="rail-capability"><i style={{ background: "#ff6d5a" }} /><span>对象与流程</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#3159f5" }} /><span>可配置路线</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#3159f5" }} /><span>任务与焦点</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#ff6d5a" }} /><span>统一收件箱</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#7657d6" }} /><span>字幕与画面</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#ff6d5a" }} /><span>创作闭环</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#3159f5" }} /><span>知识再利用</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#1f9d6a" }} /><span>多源专题</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#3159f5" }} /><span>证据关系追踪</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#7657d6" }} /><span>间隔复习</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#d39a2c" }} /><span>周度回顾</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#1f9d6a" }} /><span>本地记忆</span><b>运行中</b></div>
        <div className="rail-capability"><i style={{ background: "#3159f5" }} /><span>可逆迁移</span><b>运行中</b></div>
        <div className="rail-footer"><span>{openTasks.length}</span><p>件事仍在等待推进<br />{newInbox.length} 条输入待整理</p></div>
      </aside>

      <section className="workspace">
        {activeView === "today" && (
          <>
            <div className="workspace-heading today-heading">
              <div><p className="eyebrow">今天 · {dateLabel}</p><h1>把输入接住，<em>把最重要的事推向完成。</em></h1></div>
              <button className="reopen-guide" onClick={() => setStarterOpen(true)}>重新打开起步引导</button>
            </div>

            <div className="dayline" aria-label="今天的工作流">
              <div className="active"><i>1</i><span><strong>先接住</strong><small>{newInbox.length} 条待整理</small></span></div><b />
              <div className={openTasks.length ? "active" : ""}><i>2</i><span><strong>再推进</strong><small>{openTasks.length} 个进行中</small></span></div><b />
              <div className={completedTasks.length ? "active" : ""}><i>3</i><span><strong>有完成</strong><small>{completedTasks.length} 个已完成</small></span></div>
            </div>

            {dueStudyCards.length > 0 && <button className="today-study-callout" onClick={() => setActiveView("study")}><span>◈</span><div><small>今日到期复习</small><strong>{dueStudyCards.length} 张卡片正在等待主动回忆</strong><p>一次答对不等于学会；先完成一轮，再让间隔决定下次出现。</p></div><b>开始复习 →</b></button>}

            <div className="today-grid">
              <article className="focus-card day-focus-card">
                <div className="card-label"><span /> 今日唯一焦点</div>
                {focusTask ? (
                  <>
                    <h2>{focusTask.title}</h2>
                    <p>{focusTask.note || "只推进这一件。其他输入先交给收件箱。"}</p>
                    <div className="focus-progress"><i style={{ width: `${Math.max(18, Math.round((completedTasks.length / Math.max(1, desk.tasks.length)) * 100))}%` }} /></div>
                    <footer><span>{completedTasks.length} / {desk.tasks.length} 项完成</span><button onClick={() => toggleTask(focusTask.id)}>标记完成 →</button></footer>
                  </>
                ) : (
                  <div className="focus-empty"><h2>今天还没有焦点</h2><p>写下一件值得推进的事，工作台会把它固定在这里。</p><button onClick={() => setStarterOpen(true)}>从一件事开始</button></div>
                )}
              </article>

              <article className="capture-card live-capture-card">
                <div className="card-label">快速捕捉 · 想法或链接</div>
                <form onSubmit={saveCapture}>
                  <textarea value={captureInput} onChange={(event) => setCaptureInput(event.target.value)} aria-label="记录想法或链接" placeholder="先放在这里，不用马上分类…" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") saveCapture(); }} />
                  <footer><span>⌘ / Ctrl + Enter 保存</span><button disabled={!captureInput.trim()}>收下</button></footer>
                </form>
              </article>

              <article className="task-board">
                <header><div><div className="card-label">今日任务</div><h3>接下来做什么</h3></div><span>{completedTasks.length}/{desk.tasks.length}</span></header>
                <form className="inline-add" onSubmit={submitTask}><input value={taskInput} onChange={(event) => setTaskInput(event.target.value)} placeholder="添加一件具体的小事" aria-label="添加今日任务" /><button disabled={!taskInput.trim()}>＋</button></form>
                <div className="task-list">
                  {desk.tasks.length ? desk.tasks.slice().reverse().map((task) => (
                    <div className={`task-row ${task.done ? "done" : ""}`} key={task.id}>
                      <button className="task-check" onClick={() => toggleTask(task.id)} aria-label={`${task.done ? "恢复" : "完成"}${task.title}`}>{task.done ? "✓" : ""}</button>
                      <div><strong>{task.title}</strong><small>{task.source === "agent" ? "Agent 创建" : task.source === "inbox" ? "来自收件箱" : task.id === focusTask?.id ? "今日焦点" : "手动添加"}</small></div>
                      {!task.done && task.id !== focusTask?.id && <button className="pin-task" onClick={() => setFocus(task.id)}>设为焦点</button>}
                      <button className="remove-task" onClick={() => removeTask(task.id)} aria-label={`删除${task.title}`}>×</button>
                    </div>
                  )) : <div className="list-empty"><strong>还没有任务</strong><p>从一件 20 分钟内能推进的小事开始。</p></div>}
                </div>
              </article>

              <article className="habit-board">
                <header><div><div className="card-label">今日节律</div><h3>重复得足够轻</h3></div><span>{habitsDone}/{desk.habits.length}</span></header>
                <div className="habit-list">
                  {desk.habits.map((habit) => {
                    const checked = habit.completedDates.includes(todayKey);
                    return <button className={checked ? "checked" : ""} onClick={() => toggleHabit(habit.id)} key={habit.id}><i>{checked ? "✓" : ""}</i><span>{habit.name}</span><small>{checked ? "今天已完成" : "点一下完成"}</small></button>;
                  })}
                  {!desk.habits.length && <div className="list-empty compact"><strong>还没有固定习惯</strong><p>保持轻量，先加一个就够。</p></div>}
                </div>
                <form className="inline-add habit-add" onSubmit={addHabit}><input value={habitInput} onChange={(event) => setHabitInput(event.target.value)} placeholder="例如：阅读 20 分钟" aria-label="添加习惯" /><button disabled={!habitInput.trim()}>＋</button></form>
              </article>
            </div>
          </>
        )}

        {activeView === "routes" && hydrated && (
          <RouteWorkbench
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            routes={desk.routes}
            tasks={desk.tasks}
            habits={desk.habits}
            onNeedSettings={() => setSettingsOpen(true)}
            onSave={(route) => setDesk((current) => savePersonalRoute(current, route))}
            onActivate={(routeId, phaseId, actionId) => setDesk((current) => activateRouteAction(current, routeId, phaseId, actionId))}
            onCompletePhase={(routeId, phaseId) => setDesk((current) => completeRoutePhase(current, routeId, phaseId))}
            onArchive={(routeId) => setDesk((current) => archivePersonalRoute(current, routeId))}
          />
        )}

        {activeView === "boards" && hydrated && (
          <BoardWorkbench
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            boards={desk.boards}
            routes={desk.routes}
            tasks={desk.tasks}
            onNeedSettings={() => setSettingsOpen(true)}
            onOpenRoutes={() => setActiveView("routes")}
            onSave={(board) => setDesk((current) => savePersonalBoard(current, board))}
            onAddRecord={(boardId, input) => setDesk((current) => addBoardRecord(current, boardId, input))}
            onUpdateRecord={(boardId, recordId, input) => setDesk((current) => updateBoardRecord(current, boardId, recordId, input))}
            onRemoveRecord={(boardId, recordId) => setDesk((current) => removeBoardRecord(current, boardId, recordId))}
            onCreateTask={(boardId, recordId) => setDesk((current) => createBoardRecordTask(current, boardId, recordId))}
            onArchive={(boardId) => setDesk((current) => archivePersonalBoard(current, boardId))}
          />
        )}

        {activeView === "creator" && hydrated && (
          <CreatorStudio
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            profile={desk.creator.profile}
            signals={desk.creator.signals}
            ideas={desk.creator.ideas}
            reviews={desk.creator.reviews}
            videos={desk.videos}
            knowledge={desk.knowledge}
            boards={desk.boards}
            tasks={desk.tasks}
            onNeedSettings={() => setSettingsOpen(true)}
            onOpenVideo={() => setActiveView("video")}
            onOpenBoards={() => setActiveView("boards")}
            onSaveProfile={(profile) => setDesk((current) => saveCreatorProfile(current, profile))}
            onAddSignal={(signal) => setDesk((current) => addCreatorSignal(current, signal))}
            onRemoveSignal={(signalId) => setDesk((current) => removeCreatorSignal(current, signalId))}
            onSaveIdea={(idea) => setDesk((current) => saveCreatorIdea(current, idea))}
            onUpdateIdea={(ideaId, input) => setDesk((current) => updateCreatorIdea(current, ideaId, input))}
            onCreateIdeaTask={(ideaId) => setDesk((current) => createCreatorIdeaTask(current, ideaId))}
            onAddIdeaToBoard={(ideaId, boardId) => setDesk((current) => addCreatorIdeaToBoard(current, ideaId, boardId))}
            onRemoveIdea={(ideaId) => setDesk((current) => removeCreatorIdea(current, ideaId))}
            onSaveReview={(review) => setDesk((current) => saveCreatorReview(current, review))}
            onRemoveReview={(reviewId) => setDesk((current) => removeCreatorReview(current, reviewId))}
          />
        )}

        {activeView === "inbox" && (
          <section className="inbox-view">
            <div className="workspace-heading"><div><p className="eyebrow">统一收件箱 · 本地保存</p><h1>先捕捉，<em>稍后再决定它去哪里。</em></h1></div><div className="inbox-count"><strong>{newInbox.length}</strong><span>待处理</span></div></div>
            <form className="inbox-capture" onSubmit={saveCapture}><textarea value={captureInput} onChange={(event) => setCaptureInput(event.target.value)} aria-label="收件箱输入" placeholder="粘贴一个视频链接、网页，或者记下一段想法…" /><button disabled={!captureInput.trim()}>放进收件箱 <span>↘</span></button></form>
            <div className="inbox-list">
              {desk.inbox.length ? desk.inbox.slice().reverse().map((item) => (
                <article className={item.status === "planned" ? "planned" : ""} key={item.id}>
                  <div className={`inbox-kind ${item.kind}`}><span>{item.kind === "link" ? "↗" : "✦"}</span><small>{item.kind === "link" ? "链接" : "想法"}</small></div>
                  <div className="inbox-content">
                    {item.kind === "link" ? <a href={item.content} target="_blank" rel="noreferrer">{item.content}</a> : <p>{item.content}</p>}
                    <small>{formatTime(item.createdAt)} · {item.status === "planned" ? "已经进入后续行动" : item.kind === "link" && isSupportedVideoLink(item.content) ? "可以进入视频总结" : item.kind === "link" ? "等待网页理解能力" : "等待整理"}</small>
                  </div>
                  <div className="inbox-actions">
                    {item.kind === "link" && isSupportedVideoLink(item.content)
                      ? <button onClick={() => openVideo(item.content)}>去总结</button>
                      : <button disabled={item.status === "planned"} onClick={() => convertInboxItem(item.id)}>{item.status === "planned" ? "已安排" : "转为任务"}</button>}
                    <button className="icon-danger" onClick={() => deleteInboxItem(item.id)} aria-label="删除收件箱条目">×</button>
                  </div>
                </article>
              )) : <div className="inbox-empty"><span>↘</span><strong>收件箱现在是空的</strong><p>下一次看到值得保存的视频、网页或想法，直接扔进来。</p></div>}
            </div>
          </section>
        )}

        {activeView === "video" && (
          <VideoWorkbench
            key={videoUrl || "video-workbench"}
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            initialUrl={videoUrl}
            videos={desk.videos}
            knowledge={desk.knowledge}
            onNeedSettings={() => setSettingsOpen(true)}
            onSave={(video, createTasks) => setDesk((current) => saveVideoSummary(current, video, createTasks))}
            onSaveInquiry={(inquiry) => setDesk((current) => saveKnowledgeInquiry(current, inquiry))}
            onCreateTask={(task) => createTask(task.title, "agent", task.note)}
          />
        )}

        {activeView === "knowledge" && (
          <KnowledgeWorkbench
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            cards={desk.knowledge}
            inquiries={desk.knowledgeInquiries || []}
            onNeedSettings={() => setSettingsOpen(true)}
            onOpenVideo={() => setActiveView("video")}
            onSave={(inquiry) => setDesk((current) => saveKnowledgeInquiry(current, inquiry))}
            onCreateTask={(task) => createTask(task.title, "agent", task.note)}
          />
        )}

        {activeView === "topics" && hydrated && (
          <LearningTopicStudio
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            videos={desk.videos}
            knowledge={desk.knowledge}
            topics={desk.learningTopics}
            onNeedSettings={() => setSettingsOpen(true)}
            onOpenVideo={() => setActiveView("video")}
            onOpenKnowledge={() => setActiveView("knowledge")}
            onSave={(topic, actor) => setDesk((current) => saveLearningTopic(current, topic, actor))}
            onRemove={(topicId) => setDesk((current) => removeLearningTopic(current, topicId))}
            onCreateTask={(task) => createTask(task.title, "agent", task.note)}
          />
        )}

        {activeView === "graph" && hydrated && (
          <EvidenceAtlas
            state={desk}
            onOpenNode={(kind) => setActiveView(kind === "video" || kind === "frame" ? "video" : kind === "knowledge" ? "knowledge" : kind === "topic" ? "topics" : "study")}
            onOpenVideo={() => setActiveView("video")}
            onCreateTask={(task) => createTask(task.title, "agent", task.note)}
          />
        )}

        {activeView === "study" && hydrated && (
          <StudyStudio
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            knowledge={desk.knowledge}
            cards={desk.study.cards}
            attempts={desk.study.attempts}
            onNeedSettings={() => setSettingsOpen(true)}
            onOpenKnowledge={() => setActiveView("knowledge")}
            onSaveCards={(cards, actor) => setDesk((current) => saveStudyCards(current, cards, actor))}
            onRate={(cardId, rating, selectedAnswer) => setDesk((current) => rateStudyCard(current, cardId, rating, selectedAnswer))}
            onRemove={(cardId) => setDesk((current) => removeStudyCard(current, cardId))}
            onToggleSuspended={(cardId) => setDesk((current) => toggleStudyCardSuspended(current, cardId))}
            onCreateTask={(cardIds) => setDesk((current) => createStudyReviewTask(current, cardIds))}
          />
        )}

        {activeView === "review" && hydrated && (
          <WeeklyReview
            baseURL={baseURL}
            apiKey={apiKey}
            model={model}
            state={desk}
            reviews={desk.weeklyReviews || []}
            onNeedSettings={() => setSettingsOpen(true)}
            onSave={(review) => setDesk((current) => saveWeeklyReview(current, review))}
            onCreateTasks={(tasks) => tasks.forEach((task) => createTask(task.title, "agent", task.note))}
          />
        )}

        {activeView === "memory" && (
          <section className="memory-view">
            <p className="eyebrow">自省记忆 · 只保存在这台设备</p>
            <h1>工作台记住的不是数据，<br /><em>而是你怎样推进事情。</em></h1>
            {desk.activity.length ? desk.activity.slice().reverse().slice(0, 12).map((entry) => (
              <div className={`memory-line ${entry.source === "agent" ? "agent-memory" : ""}`} key={entry.id}>
                <time>{formatTime(entry.createdAt)}</time>
                <article><strong>{entry.label}</strong><p>{entry.detail}</p><span>{entry.source === "agent" ? "由你确认的 Agent 动作" : "来自真实使用"}</span></article>
              </div>
            )) : <div className="memory-empty"><strong>还没有形成记忆</strong><p>完成任务、整理输入或确认 Agent 动作后，这里会解释工作台为什么成为现在的样子。</p></div>}
          </section>
        )}

        {activeView === "vault" && hydrated && <DataVault state={desk} onRestore={restoreWorkbench} />}

        {activeView === "lab" && <EvolutionLab baseURL={baseURL} apiKey={apiKey} model={model} onNeedSettings={() => setSettingsOpen(true)} />}
      </section>

      {activeView === "lab" ? (
        <aside className="agent-panel lab-guardrail">
          <header><div className="agent-glyph"><span>⌁</span></div><div><strong>执行边界</strong><small>写死在本地服务中</small></div><button aria-label="打开连接设置" onClick={() => setSettingsOpen(true)}>•••</button></header>
          <div className="guardrail-intro"><span>原则 02</span><h3>Agent 可以写代码，<br />不能扩大自己的权力。</h3><p>它没有终端工具，也无法修改模型连接、沙箱规则、依赖或构建配置。</p></div>
          <ol className="guardrail-gates"><li><i>1</i><div><strong>路径门</strong><p>只允许产品界面、组件和测试文件。</p></div></li><li><i>2</i><div><strong>内容门</strong><p>阻断密钥、外部网络和动态执行。</p></div></li><li><i>3</i><div><strong>指纹门</strong><p>文件有变化就拒绝覆盖，避免踩掉人工编辑。</p></div></li><li><i>4</i><div><strong>隔离门</strong><p>临时 worktree 验证通过后才形成独立提交。</p></div></li><li><i>5</i><div><strong>远端门</strong><p>推送和草稿 PR 需要再次明确确认。</p></div></li></ol>
          <div className="protected-zone"><span>永不开放</span><code>tools/</code><code>app/api/</code><code>EvolutionLab.tsx</code><code>.env*</code><code>package.json</code><code>.git/</code></div>
          <div className="guardrail-footer"><i className={connected ? "online" : ""} /><div><strong>{connected ? "模型已连接" : "等待模型连接"}</strong><p>密钥只停留在当前页面内存</p></div><button onClick={() => setSettingsOpen(true)}>设置</button></div>
        </aside>
      ) : activeView === "vault" ? (
        <aside className="agent-panel vault-guide-panel">
          <header><div className="agent-glyph vault-glyph"><span>⇄</span></div><div><strong>迁移与同步边界</strong><small>加密封卷 · 显式设备授权</small></div></header>
          <div className="vault-guide-intro"><span>CURRENT → LOCK → AUTHORIZE → TRANSIT</span><h3>只让密文离开设备，<br />写入之前仍先看差异。</h3><p>封卷、配对、解锁和预检都发生在当前浏览器；传输层不调用模型，也不会自行连接账户或存储供应商。</p></div>
          <ol className="vault-guide-steps"><li><i>1</i><div><strong>设备私钥</strong><p>ECDH 与 ECDSA 私钥不可导出，只保存在本机 IndexedDB。</p></div></li><li><i>2</i><div><strong>明确授权</strong><p>创建设备核对指纹后，才向目标设备包装同步密钥。</p></div></li><li><i>3</i><div><strong>认证密文</strong><p>AES-256-GCM 加密工作台，设备签名绑定版本头与密文。</p></div></li><li><i>4</i><div><strong>预检与退路</strong><p>解锁后展示整体差异，写入前二次确认，本次仍可撤回。</p></div></li></ol>
          <div className="vault-guide-excludes"><span>永不进入迁移卷或同步密文</span><code>保护口令</code><code>API 密钥</code><code>Base URL</code><code>模型名称</code><code>本地视频原文件</code></div>
          <div className="guardrail-footer"><i className="online" /><div><strong>本地加密迁移与同步层就绪</strong><p>无需账户与模型连接</p></div></div>
        </aside>
      ) : activeView === "video" ? (
        <aside className="agent-panel video-guide-panel">
          <header><div className="agent-glyph video-glyph"><span>▷</span></div><div><strong>视频理解边界</strong><small>本地导入 · 有据可查</small></div><button aria-label="打开连接设置" onClick={() => setSettingsOpen(true)}>•••</button></header>
          <div className="video-guide-intro"><span>LINK OR FILE → EVIDENCE</span><h3>先得到真实字幕与画面，<br />再沿时间点理解。</h3><p>标题和封面只用于识别来源；总结与问答必须回到字幕片段或本机抽取的采样帧。</p></div>
          <ol className="video-guide-steps"><li><i>1</i><div><strong>本地导入</strong><p>支持四个平台链接与不超过 500MB 的本地音视频。</p></div></li><li><i>2</i><div><strong>字幕优先</strong><p>平台字幕直接读取；缺失时可用本机 Whisper。</p></div></li><li><i>3</i><div><strong>视觉底片</strong><p>FFmpeg 抽帧，Tesseract OCR；图片只存当前浏览器。</p></div></li><li><i>4</i><div><strong>双证据问答</strong><p>Agent 返回有效的字幕 S 编号或画面 F 编号。</p></div></li></ol>
          <div className="video-plan-b"><span>资料边界</span><p>搜索与筛选在浏览器本地完成；单次提问最多发送 12 段字幕与 4 帧选中画面到本机模型。</p></div>
          <div className="guardrail-footer"><i className={connected ? "online" : ""} /><div><strong>{connected ? "总结模型已连接" : "等待模型连接"}</strong><p>导入视频不需要模型密钥</p></div><button onClick={() => setSettingsOpen(true)}>设置</button></div>
        </aside>
      ) : activeView === "topics" ? (
        <aside className="agent-panel topic-guide-panel">
          <header><div className="agent-glyph topic-glyph"><span>⌘</span></div><div><strong>专题编织边界</strong><small>多来源 · 可回查</small></div><button aria-label="打开连接设置" onClick={() => setSettingsOpen(true)}>•••</button></header>
          <div className="topic-guide-intro"><span>SOURCES → RELATIONS → GAPS</span><h3>不是画一张好看的图，<br />而是保留理解从哪里来。</h3><p>每个节点必须引用当前专题的真实视频或知识卡；缺少证据的内容只能进入待求证区。</p></div>
          <ol className="topic-guide-steps"><li><i>1</i><div><strong>钉住资料</strong><p>最多选择 16 条本地视频总结和知识卡。</p></div></li><li><i>2</i><div><strong>围绕问题</strong><p>先写学习目标，避免按来源机械复述。</p></div></li><li><i>3</i><div><strong>重绑引用</strong><p>服务端只保留实际提供的 S 编号与节点关系。</p></div></li><li><i>4</i><div><strong>审阅修订</strong><p>新增资料后先比较保留、改写与移除，再决定是否采用。</p></div></li><li><i>5</i><div><strong>留下缺口</strong><p>采用后的开放问题可以明确加入今日求证任务。</p></div></li></ol>
          <div className="video-plan-b"><span>资料边界</span><p>摘要筛选在浏览器完成；原始关键帧与完整字幕不会随专题请求发送。</p></div>
          <div className="guardrail-footer"><i className={connected ? "online" : ""} /><div><strong>{connected ? "专题模型已连接" : "等待模型连接"}</strong><p>资料架可以离线保存</p></div><button onClick={() => setSettingsOpen(true)}>设置</button></div>
        </aside>
      ) : activeView === "graph" ? (
        <aside className="agent-panel topic-guide-panel atlas-guide-panel">
          <header><div className="agent-glyph atlas-glyph"><span>✦</span></div><div><strong>关系追踪边界</strong><small>本地标识 · 确定性生成</small></div><button aria-label="打开连接设置" onClick={() => setSettingsOpen(true)}>•••</button></header>
          <div className="topic-guide-intro"><span>IDS → EDGES → TRACE</span><h3>这张图不猜“相关”，<br />只展开已经发生的连接。</h3><p>视频 URL、画面 ID、知识卡 ID、专题来源和复习来源共同决定关系；模型无法在这里新增边。</p></div>
          <ol className="topic-guide-steps"><li><i>1</i><div><strong>明确引用</strong><p>实线来自保存时已经校验过的对象标识。</p></div></li><li><i>2</i><div><strong>语义旁路</strong><p>知识卡点线只提示共享标签或词项，不冒充因果。</p></div></li><li><i>3</i><div><strong>最近来源链</strong><p>从专题或复习反向找到视频与画面。</p></div></li><li><i>4</i><div><strong>暴露悬空</strong><p>找不到来源时明确列出，并可加入补证任务。</p></div></li></ol>
          <div className="video-plan-b"><span>计算边界</span><p>图谱只在当前浏览器根据本地工作台状态计算；不会发送资料，也不会写入新的隐藏关系。</p></div>
          <div className="guardrail-footer"><i className="online" /><div><strong>本地关系层就绪</strong><p>无需模型连接</p></div><button onClick={() => setActiveView("video")}>加资料</button></div>
        </aside>
      ) : (
        <WorkAgent baseURL={baseURL} apiKey={apiKey} model={model} connected={connected} state={desk} onNeedSettings={() => setSettingsOpen(true)} onApply={applyWorkPlan} />
      )}

      {starterOpen && <QuickStart connected={connected} onClose={finishOnboarding} onOpenSettings={() => setSettingsOpen(true)} onCreateTask={(title) => createTask(title)} />}

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">×</button>
            <p className="eyebrow">本地连接</p><h2 id="settings-title">把 Agent 接到你的模型</h2>
            <p className="modal-copy">密钥只停留在当前页面内存，不会写入代码或浏览器存储。刷新页面后需要重新输入。</p>
            <label>Base URL<input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} /></label>
            <label>API 密钥<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入本地服务密钥" autoComplete="off" /></label>
            <label>模型{models.length ? <select value={model} onChange={(event) => setModel(event.target.value)}>{models.map((item) => <option key={item}>{item}</option>)}</select> : <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="连接后自动发现，也可手动填写" />}</label>
            <div className="settings-note"><span>安全边界</span><p>只允许连接 localhost / 127.0.0.1。行动 Agent 只能提出结构化动作；源码 Agent 只返回白名单文件内容，不能自行提交或推送。</p></div>
            <button className="connect-button" onClick={connect}>{connected ? "重新检查连接" : "检查连接"}</button>
          </section>
        </div>
      )}
    </main>
  );
}
