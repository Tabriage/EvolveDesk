export const WORKBENCH_STORAGE_KEY = "evolve-desk.workspace.v1";

const MAX_TASKS = 120;
const MAX_INBOX_ITEMS = 160;
const MAX_HABITS = 12;
const MAX_ACTIVITY = 80;
const MAX_VIDEOS = 40;
const MAX_KNOWLEDGE_CARDS = 120;
const MAX_KNOWLEDGE_INQUIRIES = 40;
const MAX_WEEKLY_REVIEWS = 24;
const MAX_PERSONAL_ROUTES = 12;
const MAX_ROUTE_PHASES = 6;
const MAX_ROUTE_ACTIONS = 5;
const MAX_PERSONAL_BOARDS = 10;
const MAX_BOARD_STATUSES = 6;
const MAX_BOARD_FIELDS = 6;
const MAX_BOARD_RECORDS = 80;

function cleanText(value, limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function createId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalWeek(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  return value;
}

export function getWeekKey(date = new Date()) {
  return getTodayKey(startOfLocalWeek(date));
}

function addLocalDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function dateInRange(value, start, end) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function inboxKind(content) {
  return /^https?:\/\/\S+$/i.test(cleanText(content, 2_000)) ? "link" : "note";
}

export function createInitialWorkbench() {
  return {
    version: 7,
    focusTaskId: null,
    tasks: [],
    inbox: [],
    habits: [],
    activity: [],
    videos: [],
    knowledge: [],
    knowledgeInquiries: [],
    weeklyReviews: [],
    routes: [],
    boards: [],
  };
}

function validArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeVideoSummary(summary) {
  const value = summary && typeof summary === "object" ? summary : {};
  return {
    oneSentence: cleanText(value.oneSentence, 300),
    audience: cleanText(value.audience, 180),
    worthWatching: cleanText(value.worthWatching, 220),
    informationDensity: ["low", "medium", "high"].includes(value.informationDensity) ? value.informationDensity : "medium",
    keyPoints: validArray(value.keyPoints).slice(0, 10).map((point) => ({
      title: cleanText(point?.title, 120),
      detail: cleanText(point?.detail, 700),
      timestamp: point?.timestamp ? cleanText(point.timestamp, 16) : null,
    })).filter((point) => point.title && point.detail),
    chapters: validArray(value.chapters).slice(0, 14).map((chapter) => ({
      title: cleanText(chapter?.title, 120),
      summary: cleanText(chapter?.summary, 600),
      timestamp: chapter?.timestamp ? cleanText(chapter.timestamp, 16) : null,
    })).filter((chapter) => chapter.title && chapter.summary),
    concepts: validArray(value.concepts).slice(0, 8).map((concept) => ({
      term: cleanText(concept?.term, 80),
      explanation: cleanText(concept?.explanation, 500),
    })).filter((concept) => concept.term && concept.explanation),
    caveats: validArray(value.caveats).slice(0, 6).map((item) => cleanText(item, 300)).filter(Boolean),
    creatorInsights: {
      hook: cleanText(value.creatorInsights?.hook, 300),
      structure: cleanText(value.creatorInsights?.structure, 500),
      angles: validArray(value.creatorInsights?.angles).slice(0, 5).map((item) => cleanText(item, 240)).filter(Boolean),
    },
    suggestedTasks: validArray(value.suggestedTasks).slice(0, 6).map((task) => ({
      title: cleanText(task?.title, 120),
      note: cleanText(task?.note, 320),
    })).filter((task) => task.title),
    cards: validArray(value.cards).slice(0, 8).map((card) => ({
      title: cleanText(card?.title, 120),
      content: cleanText(card?.content, 1_200),
      tags: validArray(card?.tags).slice(0, 5).map((tag) => cleanText(tag, 24)).filter(Boolean),
    })).filter((card) => card.title && card.content),
  };
}

function sanitizeKnowledgeInquiry(inquiry) {
  const value = inquiry && typeof inquiry === "object" ? inquiry : {};
  return {
    id: cleanText(value.id, 100) || createId("inquiry"),
    question: cleanText(value.question, 600),
    answerable: Boolean(value.answerable),
    answer: cleanText(value.answer, 3_000),
    keyPoints: validArray(value.keyPoints).slice(0, 6).map((item) => cleanText(item, 500)).filter(Boolean),
    gaps: validArray(value.gaps).slice(0, 5).map((item) => cleanText(item, 360)).filter(Boolean),
    sources: validArray(value.sources).slice(0, 12).map((source) => ({
      cardId: cleanText(source?.cardId, 100),
      cardTitle: cleanText(source?.cardTitle, 120),
      sourceTitle: cleanText(source?.sourceTitle, 240),
      sourceUrl: cleanText(source?.sourceUrl, 2_000),
    })).filter((source) => source.cardId && source.cardTitle),
    suggestedTask: value.suggestedTask?.title ? {
      title: cleanText(value.suggestedTask.title, 120),
      note: cleanText(value.suggestedTask.note, 320),
    } : null,
    createdAt: cleanText(value.createdAt, 40) || new Date().toISOString(),
  };
}

function sanitizeWeeklyReview(review) {
  const value = review && typeof review === "object" ? review : {};
  const stats = value.sourceStats && typeof value.sourceStats === "object" ? value.sourceStats : {};
  const safeCount = (count) => Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return {
    id: cleanText(value.id, 100) || createId("review"),
    weekKey: cleanText(value.weekKey, 10),
    periodLabel: cleanText(value.periodLabel, 40),
    headline: cleanText(value.headline, 100),
    summary: cleanText(value.summary, 1_200),
    wins: validArray(value.wins).slice(0, 5).map((item) => cleanText(item, 360)).filter(Boolean),
    friction: validArray(value.friction).slice(0, 5).map((item) => cleanText(item, 360)).filter(Boolean),
    knowledgeConnections: validArray(value.knowledgeConnections).slice(0, 5).map((item) => cleanText(item, 420)).filter(Boolean),
    nextWeekFocus: cleanText(value.nextWeekFocus, 360),
    suggestedActions: validArray(value.suggestedActions).slice(0, 4).map((action) => ({
      title: cleanText(action?.title, 120),
      note: cleanText(action?.note, 320),
    })).filter((action) => action.title),
    sourceStats: {
      completedTasks: safeCount(stats.completedTasks),
      createdTasks: safeCount(stats.createdTasks),
      capturedItems: safeCount(stats.capturedItems),
      plannedItems: safeCount(stats.plannedItems),
      habitCheckins: safeCount(stats.habitCheckins),
      videos: safeCount(stats.videos),
      knowledgeCards: safeCount(stats.knowledgeCards),
      knowledgeInquiries: safeCount(stats.knowledgeInquiries),
    },
    createdAt: cleanText(value.createdAt, 40) || new Date().toISOString(),
  };
}

function sanitizePersonalRoute(route) {
  const value = route && typeof route === "object" ? route : {};
  const seenPhaseIds = new Set();
  const seenActionIds = new Set();
  const phases = validArray(value.phases).slice(0, MAX_ROUTE_PHASES).map((phase) => {
    let phaseId = cleanText(phase?.id, 100) || createId("phase");
    if (seenPhaseIds.has(phaseId)) phaseId = createId("phase");
    seenPhaseIds.add(phaseId);
    const actions = validArray(phase?.actions).slice(0, MAX_ROUTE_ACTIONS).map((action) => {
      let actionId = cleanText(action?.id, 100) || createId("route-action");
      if (seenActionIds.has(actionId)) actionId = createId("route-action");
      seenActionIds.add(actionId);
      return {
        id: actionId,
        title: cleanText(action?.title, 120),
        note: cleanText(action?.note, 320),
        mode: action?.mode === "habit" ? "habit" : "task",
        linkedTaskId: action?.linkedTaskId ? cleanText(action.linkedTaskId, 100) : null,
        linkedHabitId: action?.linkedHabitId ? cleanText(action.linkedHabitId, 100) : null,
      };
    }).filter((action) => action.title);
    return {
      id: phaseId,
      title: cleanText(phase?.title, 80),
      outcome: cleanText(phase?.outcome, 260),
      completionRule: cleanText(phase?.completionRule, 220),
      actions,
      completedAt: phase?.completedAt ? cleanText(phase.completedAt, 40) : null,
    };
  }).filter((phase) => phase.title && phase.outcome && phase.actions.length);
  const now = new Date().toISOString();
  return {
    id: cleanText(value.id, 100) || createId("route"),
    name: cleanText(value.name, 40),
    purpose: cleanText(value.purpose, 360),
    category: ["create", "learn", "practice", "manage"].includes(value.category) ? value.category : "practice",
    accent: ["blue", "coral", "violet", "green", "amber"].includes(value.accent) ? value.accent : "blue",
    cadence: cleanText(value.cadence, 100),
    successMetric: cleanText(value.successMetric, 220),
    reflection: cleanText(value.reflection, 500),
    phases,
    createdAt: cleanText(value.createdAt, 40) || now,
    updatedAt: cleanText(value.updatedAt, 40) || now,
    archivedAt: value.archivedAt ? cleanText(value.archivedAt, 40) : null,
  };
}

function sanitizeBoardField(field, seenIds) {
  let id = cleanText(field?.id, 100) || createId("board-field");
  if (seenIds.has(id)) id = createId("board-field");
  seenIds.add(id);
  const type = ["text", "number", "date", "select", "checkbox"].includes(field?.type) ? field.type : "text";
  return {
    id,
    name: cleanText(field?.name, 30),
    type,
    required: Boolean(field?.required),
    options: type === "select"
      ? [...new Set(validArray(field?.options).slice(0, 8).map((option) => cleanText(option, 30)).filter(Boolean))]
      : [],
  };
}

function sanitizeBoardValues(fields, values) {
  const source = values && typeof values === "object" ? values : {};
  return Object.fromEntries(fields.map((field) => {
    const value = source[field.id];
    if (field.type === "checkbox") return [field.id, Boolean(value)];
    if (field.type === "number") {
      const number = typeof value === "number" ? value : Number(value);
      return [field.id, Number.isFinite(number) ? number : 0];
    }
    const text = cleanText(value, field.type === "text" ? 500 : 80);
    if (field.type === "date") return [field.id, /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""];
    if (field.type === "select") return [field.id, field.options.includes(text) ? text : ""];
    return [field.id, text];
  }));
}

function sanitizePersonalBoard(board) {
  const value = board && typeof board === "object" ? board : {};
  const seenStatusIds = new Set();
  let statuses = validArray(value.statuses).slice(0, MAX_BOARD_STATUSES).map((status) => {
    let id = cleanText(status?.id, 100) || createId("board-status");
    if (seenStatusIds.has(id)) id = createId("board-status");
    seenStatusIds.add(id);
    return {
      id,
      label: cleanText(status?.label, 20),
      tone: ["blue", "coral", "violet", "green", "amber", "slate"].includes(status?.tone) ? status.tone : "slate",
      done: Boolean(status?.done),
    };
  }).filter((status) => status.label);
  if (statuses.length && !statuses.some((status) => status.done)) {
    statuses = statuses.map((status, index) => index === statuses.length - 1 ? { ...status, done: true } : status);
  }
  const seenFieldIds = new Set();
  const fields = validArray(value.fields).slice(0, MAX_BOARD_FIELDS)
    .map((field) => sanitizeBoardField(field, seenFieldIds))
    .filter((field) => field.name && (field.type !== "select" || field.options.length));
  const firstStatusId = statuses[0]?.id || "";
  const statusIds = new Set(statuses.map((status) => status.id));
  const seenRecordIds = new Set();
  const records = validArray(value.records).slice(-MAX_BOARD_RECORDS).map((record) => {
    let id = cleanText(record?.id, 100) || createId("board-record");
    if (seenRecordIds.has(id)) id = createId("board-record");
    seenRecordIds.add(id);
    return {
      id,
      title: cleanText(record?.title, 120),
      statusId: statusIds.has(record?.statusId) ? record.statusId : firstStatusId,
      values: sanitizeBoardValues(fields, record?.values),
      linkedTaskId: record?.linkedTaskId ? cleanText(record.linkedTaskId, 100) : null,
      createdAt: cleanText(record?.createdAt, 40) || new Date().toISOString(),
      updatedAt: cleanText(record?.updatedAt, 40) || new Date().toISOString(),
    };
  }).filter((record) => record.title && record.statusId);
  const linkedRouteId = value.linkedRouteId ? cleanText(value.linkedRouteId, 100) : null;
  const now = new Date().toISOString();
  return {
    id: cleanText(value.id, 100) || createId("board"),
    name: cleanText(value.name, 40),
    purpose: cleanText(value.purpose, 360),
    itemLabel: cleanText(value.itemLabel, 20) || "记录",
    accent: ["blue", "coral", "violet", "green", "amber"].includes(value.accent) ? value.accent : "blue",
    defaultView: value.defaultView === "table" ? "table" : "board",
    reflection: cleanText(value.reflection, 500),
    linkedRouteId,
    statuses,
    fields,
    records,
    createdAt: cleanText(value.createdAt, 40) || now,
    updatedAt: cleanText(value.updatedAt, 40) || now,
    archivedAt: value.archivedAt ? cleanText(value.archivedAt, 40) : null,
  };
}

export function parseWorkbenchState(raw) {
  if (!raw) return createInitialWorkbench();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return createInitialWorkbench();
    const tasks = validArray(parsed.tasks).slice(-MAX_TASKS).map((task) => ({
      id: cleanText(task.id, 100) || createId("task"),
      title: cleanText(task.title, 120),
      note: cleanText(task.note, 320),
      priority: ["low", "normal", "high"].includes(task.priority) ? task.priority : "normal",
      done: Boolean(task.done),
      source: ["manual", "agent", "inbox"].includes(task.source) ? task.source : "manual",
      createdAt: cleanText(task.createdAt, 40) || new Date().toISOString(),
      completedAt: task.completedAt ? cleanText(task.completedAt, 40) : null,
    })).filter((task) => task.title);
    const inbox = validArray(parsed.inbox).slice(-MAX_INBOX_ITEMS).map((item) => ({
      id: cleanText(item.id, 100) || createId("inbox"),
      content: cleanText(item.content, 2_000),
      kind: item.kind === "link" ? "link" : "note",
      status: item.status === "planned" ? "planned" : "new",
      createdAt: cleanText(item.createdAt, 40) || new Date().toISOString(),
    })).filter((item) => item.content);
    const habits = validArray(parsed.habits).slice(-MAX_HABITS).map((habit) => ({
      id: cleanText(habit.id, 100) || createId("habit"),
      name: cleanText(habit.name, 50),
      completedDates: validArray(habit.completedDates).map((date) => cleanText(date, 10)).slice(-90),
    })).filter((habit) => habit.name);
    const activity = validArray(parsed.activity).slice(-MAX_ACTIVITY).map((entry) => ({
      id: cleanText(entry.id, 100) || createId("activity"),
      label: cleanText(entry.label, 100),
      detail: cleanText(entry.detail, 240),
      createdAt: cleanText(entry.createdAt, 40) || new Date().toISOString(),
      source: entry.source === "agent" ? "agent" : "human",
    })).filter((entry) => entry.label);
    const videos = validArray(parsed.videos).slice(-MAX_VIDEOS).map((video) => ({
      id: cleanText(video.id, 100) || createId("video"),
      url: cleanText(video.url, 2_000),
      platform: ["youtube", "bilibili", "xiaohongshu", "douyin", "local"].includes(video.platform) ? video.platform : "youtube",
      sourceId: cleanText(video.sourceId, 120),
      title: cleanText(video.title, 240),
      author: cleanText(video.author, 120),
      description: cleanText(video.description, 800),
      duration: Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : null,
      thumbnail: cleanText(video.thumbnail, 2_000),
      localFileName: cleanText(video.localFileName, 180),
      transcriptSource: video.transcriptSource === "manual"
        ? "manual"
        : video.transcriptSource === "local-whisper" ? "local-whisper" : "platform",
      summary: sanitizeVideoSummary(video.summary),
      createdAt: cleanText(video.createdAt, 40) || new Date().toISOString(),
    })).filter((video) => video.url && video.title && video.summary.oneSentence);
    const knowledge = validArray(parsed.knowledge).slice(-MAX_KNOWLEDGE_CARDS).map((card) => ({
      id: cleanText(card.id, 100) || createId("knowledge"),
      title: cleanText(card.title, 120),
      content: cleanText(card.content, 1_200),
      tags: validArray(card.tags).slice(0, 5).map((tag) => cleanText(tag, 24)).filter(Boolean),
      sourceUrl: cleanText(card.sourceUrl, 2_000),
      sourceTitle: cleanText(card.sourceTitle, 240),
      createdAt: cleanText(card.createdAt, 40) || new Date().toISOString(),
    })).filter((card) => card.title && card.content);
    const knowledgeInquiries = validArray(parsed.knowledgeInquiries)
      .slice(-MAX_KNOWLEDGE_INQUIRIES)
      .map(sanitizeKnowledgeInquiry)
      .filter((inquiry) => inquiry.question && inquiry.answer);
    const weeklyReviews = validArray(parsed.weeklyReviews)
      .slice(-MAX_WEEKLY_REVIEWS)
      .map(sanitizeWeeklyReview)
      .filter((review) => review.weekKey && review.headline && review.summary && review.nextWeekFocus);
    const routes = validArray(parsed.routes)
      .slice(-MAX_PERSONAL_ROUTES)
      .map(sanitizePersonalRoute)
      .filter((route) => route.name && route.purpose && route.phases.length);
    const routeIds = new Set(routes.map((route) => route.id));
    const taskIds = new Set(tasks.map((task) => task.id));
    const boards = validArray(parsed.boards)
      .slice(-MAX_PERSONAL_BOARDS)
      .map(sanitizePersonalBoard)
      .map((board) => board.linkedRouteId && !routeIds.has(board.linkedRouteId) ? { ...board, linkedRouteId: null } : board)
      .map((board) => ({
        ...board,
        records: board.records.map((record) => record.linkedTaskId && !taskIds.has(record.linkedTaskId) ? { ...record, linkedTaskId: null } : record),
      }))
      .filter((board) => board.name && board.purpose && board.statuses.length >= 2 && board.fields.length);
    const focusTaskId = tasks.some((task) => task.id === parsed.focusTaskId) ? parsed.focusTaskId : null;
    return { version: 7, focusTaskId, tasks, inbox, habits, activity, videos, knowledge, knowledgeInquiries, weeklyReviews, routes, boards };
  } catch {
    return createInitialWorkbench();
  }
}

export function addTask(state, input) {
  const title = cleanText(input?.title, 120);
  if (!title) return state;
  const task = {
    id: createId("task"),
    title,
    note: cleanText(input?.note, 320),
    priority: ["low", "normal", "high"].includes(input?.priority) ? input.priority : "normal",
    done: false,
    source: ["manual", "agent", "inbox"].includes(input?.source) ? input.source : "manual",
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  return {
    ...state,
    focusTaskId: state.focusTaskId || task.id,
    tasks: [...state.tasks, task].slice(-MAX_TASKS),
  };
}

export function addInboxItem(state, content, source = "human") {
  const value = cleanText(content, 2_000);
  if (!value) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    inbox: [...state.inbox, {
      id: createId("inbox"),
      content: value,
      kind: inboxKind(value),
      status: "new",
      createdAt: now,
    }].slice(-MAX_INBOX_ITEMS),
    activity: [...state.activity, {
      id: createId("activity"),
      label: inboxKind(value) === "link" ? "收下一个链接" : "收下一条想法",
      detail: value,
      createdAt: now,
      source,
    }].slice(-MAX_ACTIVITY),
  };
}

export function applyAgentActions(state, actions, planTitle = "Agent 整理工作台") {
  let next = state;
  for (const rawAction of validArray(actions).slice(0, 6)) {
    if (rawAction?.type === "add_task") {
      next = addTask(next, { ...rawAction, source: "agent" });
    } else if (rawAction?.type === "save_inbox") {
      next = addInboxItem(next, rawAction.content, "agent");
    } else if (rawAction?.type === "add_habit") {
      const name = cleanText(rawAction.name, 50);
      if (name && next.habits.length < MAX_HABITS && !next.habits.some((habit) => habit.name === name)) {
        next = { ...next, habits: [...next.habits, { id: createId("habit"), name, completedDates: [] }] };
      }
    } else if (rawAction?.type === "set_focus") {
      const title = cleanText(rawAction.title, 120);
      const existing = next.tasks.find((task) => task.title === title && !task.done);
      if (existing) {
        next = { ...next, focusTaskId: existing.id };
      } else if (title) {
        next = addTask(next, { title, note: rawAction.note, priority: "high", source: "agent" });
        next = { ...next, focusTaskId: next.tasks.at(-1)?.id || next.focusTaskId };
      }
    } else if (rawAction?.type === "activate_route_action") {
      next = activateRouteAction(next, rawAction.routeId, rawAction.phaseId, rawAction.actionId, false);
    } else if (rawAction?.type === "add_board_record") {
      next = addBoardRecord(next, rawAction.boardId, {
        title: rawAction.title,
        statusId: rawAction.statusId,
      }, false);
    } else if (rawAction?.type === "advance_board_record") {
      next = updateBoardRecord(next, rawAction.boardId, rawAction.recordId, {
        statusId: rawAction.statusId,
      }, false);
    } else if (rawAction?.type === "create_board_task") {
      next = createBoardRecordTask(next, rawAction.boardId, rawAction.recordId, false);
    }
  }
  const now = new Date().toISOString();
  return {
    ...next,
    activity: [...next.activity, {
      id: createId("activity"),
      label: cleanText(planTitle, 100) || "Agent 整理工作台",
      detail: `确认执行 ${Math.min(validArray(actions).length, 6)} 个动作`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function saveVideoSummary(state, input, createTasks = false) {
  const summary = sanitizeVideoSummary(input?.summary);
  const url = cleanText(input?.url, 2_000);
  const title = cleanText(input?.title, 240);
  if (!url || !title || !summary.oneSentence) return state;
  const now = new Date().toISOString();
  const existing = state.videos.find((video) => video.url === url);
  const video = {
    id: existing?.id || createId("video"),
    url,
    platform: ["youtube", "bilibili", "xiaohongshu", "douyin", "local"].includes(input?.platform) ? input.platform : "youtube",
    sourceId: cleanText(input?.sourceId, 120),
    title,
    author: cleanText(input?.author, 120),
    description: cleanText(input?.description, 800),
    duration: Number.isFinite(input?.duration) ? Math.max(0, Math.round(input.duration)) : null,
    thumbnail: cleanText(input?.thumbnail, 2_000),
    localFileName: cleanText(input?.localFileName, 180),
    transcriptSource: input?.transcriptSource === "manual"
      ? "manual"
      : input?.transcriptSource === "local-whisper" ? "local-whisper" : "platform",
    summary,
    createdAt: existing?.createdAt || now,
  };
  let next = {
    ...state,
    version: 7,
    videos: [...state.videos.filter((item) => item.url !== url), video].slice(-MAX_VIDEOS),
    inbox: state.inbox.map((item) => item.content === url || item.content === cleanText(input?.capturedUrl, 2_000) ? { ...item, status: "planned" } : item),
  };
  const freshCards = summary.cards.map((card) => ({
    id: createId("knowledge"),
    ...card,
    sourceUrl: url,
    sourceTitle: title,
    createdAt: now,
  }));
  next = {
    ...next,
    knowledge: [
      ...next.knowledge.filter((card) => card.sourceUrl !== url),
      ...freshCards,
    ].slice(-MAX_KNOWLEDGE_CARDS),
  };
  if (createTasks) {
    for (const task of summary.suggestedTasks) next = addTask(next, { ...task, source: "agent" });
  }
  return {
    ...next,
    activity: [...next.activity, {
      id: createId("activity"),
      label: createTasks ? "保存视频总结并生成任务" : "保存视频总结",
      detail: `${title} · ${freshCards.length} 张知识卡片${createTasks ? ` · ${summary.suggestedTasks.length} 个任务` : ""}`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function saveKnowledgeInquiry(state, input) {
  const inquiry = sanitizeKnowledgeInquiry({
    ...input,
    id: createId("inquiry"),
    createdAt: new Date().toISOString(),
  });
  if (!inquiry.question || !inquiry.answer) return state;
  return {
    ...state,
    version: 7,
    knowledgeInquiries: [...validArray(state.knowledgeInquiries), inquiry].slice(-MAX_KNOWLEDGE_INQUIRIES),
    activity: [...state.activity, {
      id: createId("activity"),
      label: "保存一次知识问答",
      detail: `${inquiry.question} · ${inquiry.sources.length} 条引用`,
      createdAt: inquiry.createdAt,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function buildWeeklySnapshot(state, anchorDate = new Date()) {
  const start = startOfLocalWeek(anchorDate);
  const end = addLocalDays(start, 7);
  const dayKeys = Array.from({ length: 7 }, (_, index) => getTodayKey(addLocalDays(start, index)));
  const keyIndex = new Map(dayKeys.map((key, index) => [key, index]));
  const days = dayKeys.map((key, index) => {
    const date = addLocalDays(start, index);
    return {
      key,
      label: ["一", "二", "三", "四", "五", "六", "日"][index],
      dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
      tasksCreated: 0,
      tasksCompleted: 0,
      inboxCaptured: 0,
      habitCheckins: 0,
      videos: 0,
      knowledgeCards: 0,
      inquiries: 0,
      activityCount: 0,
      total: 0,
    };
  });
  const dayForTimestamp = (timestamp) => {
    if (!dateInRange(timestamp, start, end)) return null;
    return days[keyIndex.get(getTodayKey(new Date(timestamp)))] || null;
  };
  const tasksCreated = validArray(state.tasks).filter((task) => dateInRange(task.createdAt, start, end));
  const completedTasks = validArray(state.tasks).filter((task) => task.completedAt && dateInRange(task.completedAt, start, end));
  const capturedItems = validArray(state.inbox).filter((item) => dateInRange(item.createdAt, start, end));
  const videos = validArray(state.videos).filter((video) => dateInRange(video.createdAt, start, end));
  const knowledgeCards = validArray(state.knowledge).filter((card) => dateInRange(card.createdAt, start, end));
  const inquiries = validArray(state.knowledgeInquiries).filter((inquiry) => dateInRange(inquiry.createdAt, start, end));
  const activity = validArray(state.activity).filter((entry) => dateInRange(entry.createdAt, start, end));

  for (const task of tasksCreated) dayForTimestamp(task.createdAt).tasksCreated += 1;
  for (const task of completedTasks) dayForTimestamp(task.completedAt).tasksCompleted += 1;
  for (const item of capturedItems) dayForTimestamp(item.createdAt).inboxCaptured += 1;
  for (const video of videos) dayForTimestamp(video.createdAt).videos += 1;
  for (const card of knowledgeCards) dayForTimestamp(card.createdAt).knowledgeCards += 1;
  for (const inquiry of inquiries) dayForTimestamp(inquiry.createdAt).inquiries += 1;
  for (const entry of activity) dayForTimestamp(entry.createdAt).activityCount += 1;

  let habitCheckins = 0;
  for (const habit of validArray(state.habits)) {
    for (const dateKey of validArray(habit.completedDates)) {
      const day = days[keyIndex.get(dateKey)];
      if (!day) continue;
      day.habitCheckins += 1;
      habitCheckins += 1;
    }
  }
  for (const day of days) {
    day.total = day.tasksCreated + day.tasksCompleted + day.inboxCaptured + day.habitCheckins
      + day.videos + day.knowledgeCards + day.inquiries;
  }
  const sourceStats = {
    completedTasks: completedTasks.length,
    createdTasks: tasksCreated.length,
    capturedItems: capturedItems.length,
    plannedItems: capturedItems.filter((item) => item.status === "planned").length,
    habitCheckins,
    videos: videos.length,
    knowledgeCards: knowledgeCards.length,
    knowledgeInquiries: inquiries.length,
  };
  const evidenceTotal = Object.values(sourceStats).reduce((total, count) => total + count, 0);
  return {
    weekKey: getTodayKey(start),
    startDate: getTodayKey(start),
    endDate: getTodayKey(addLocalDays(end, -1)),
    periodLabel: `${formatShortDate(start)}—${formatShortDate(addLocalDays(end, -1))}`,
    days,
    completedTasks: completedTasks.slice(-12).map(({ id, title, note, completedAt }) => ({ id, title, note, completedAt })),
    createdTasks: tasksCreated.slice(-12).map(({ id, title, note, done, createdAt }) => ({ id, title, note, done, createdAt })),
    openTasks: validArray(state.tasks).filter((task) => !task.done).slice(-8).map(({ id, title, note, priority, createdAt }) => ({ id, title, note, priority, createdAt })),
    capturedItems: capturedItems.slice(-12).map(({ id, content, kind, status, createdAt }) => ({ id, content, kind, status, createdAt })),
    videos: videos.slice(-8).map(({ id, title, platform, createdAt }) => ({ id, title, platform, createdAt })),
    knowledgeCards: knowledgeCards.slice(-12).map(({ id, title, tags, sourceTitle, createdAt }) => ({ id, title, tags, sourceTitle, createdAt })),
    inquiries: inquiries.slice(-8).map(({ id, question, answerable, sources, createdAt }) => ({
      id,
      question,
      answerable,
      sourceCount: validArray(sources).length,
      createdAt,
    })),
    activity: activity.slice(-16).map(({ label, detail, source, createdAt }) => ({ label, detail, source, createdAt })),
    sourceStats,
    hasEvidence: evidenceTotal > 0 || activity.length > 0,
  };
}

export function saveWeeklyReview(state, input) {
  const existing = validArray(state.weeklyReviews).find((review) => review.weekKey === cleanText(input?.weekKey, 10));
  const review = sanitizeWeeklyReview({
    ...input,
    id: existing?.id || createId("review"),
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
  if (!review.weekKey || !review.headline || !review.summary || !review.nextWeekFocus) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 7,
    weeklyReviews: [
      ...validArray(state.weeklyReviews).filter((item) => item.weekKey !== review.weekKey),
      review,
    ].slice(-MAX_WEEKLY_REVIEWS),
    activity: [...state.activity, {
      id: createId("activity"),
      label: existing ? "更新本周回顾" : "保存本周回顾",
      detail: `${review.periodLabel} · ${review.headline}`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function savePersonalRoute(state, input) {
  const now = new Date().toISOString();
  const existing = validArray(state.routes).find((route) => route.id === input?.id);
  const route = sanitizePersonalRoute({
    ...input,
    id: existing?.id || input?.id,
    createdAt: existing?.createdAt || input?.createdAt || now,
    updatedAt: now,
    archivedAt: null,
  });
  if (!route.name || !route.purpose || !route.phases.length) return state;
  const isUpdate = Boolean(existing);
  return {
    ...state,
    version: 7,
    routes: [...validArray(state.routes).filter((item) => item.id !== route.id), route].slice(-MAX_PERSONAL_ROUTES),
    activity: [...state.activity, {
      id: createId("activity"),
      label: isUpdate ? "调整一条个人路线" : "建立一条个人路线",
      detail: `${route.name} · ${route.phases.length} 个阶段`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function activateRouteAction(state, routeId, phaseId, actionId, recordActivity = true) {
  const route = validArray(state.routes).find((item) => item.id === routeId && !item.archivedAt);
  const phase = route?.phases.find((item) => item.id === phaseId);
  const action = phase?.actions.find((item) => item.id === actionId);
  if (!route || !phase || !action || action.linkedTaskId || action.linkedHabitId) return state;

  let next = state;
  let linkedTaskId = null;
  let linkedHabitId = null;
  if (action.mode === "habit") {
    const existingHabit = state.habits.find((habit) => habit.name === action.title);
    if (existingHabit) {
      linkedHabitId = existingHabit.id;
    } else {
      if (state.habits.length >= MAX_HABITS) return state;
      linkedHabitId = createId("habit");
      next = { ...state, habits: [...state.habits, { id: linkedHabitId, name: action.title, completedDates: [] }] };
    }
  } else {
    next = addTask(state, {
      title: action.title,
      note: [action.note, `来自路线「${route.name}」· ${phase.title}`].filter(Boolean).join(" · "),
      priority: "normal",
      source: "agent",
    });
    linkedTaskId = next.tasks.at(-1)?.id || null;
  }

  const updatedAt = new Date().toISOString();
  const routes = validArray(next.routes).map((item) => item.id !== route.id ? item : {
    ...item,
    updatedAt,
    phases: item.phases.map((phaseItem) => phaseItem.id !== phase.id ? phaseItem : {
      ...phaseItem,
      actions: phaseItem.actions.map((actionItem) => actionItem.id !== action.id ? actionItem : {
        ...actionItem,
        linkedTaskId,
        linkedHabitId,
      }),
    }),
  });
  const activity = recordActivity ? [...next.activity, {
    id: createId("activity"),
    label: action.mode === "habit" ? "从路线建立习惯" : "从路线加入任务",
    detail: `${route.name} · ${action.title}`,
    createdAt: updatedAt,
    source: "agent",
  }].slice(-MAX_ACTIVITY) : next.activity;
  return { ...next, version: 7, routes, activity };
}

export function completeRoutePhase(state, routeId, phaseId) {
  const route = validArray(state.routes).find((item) => item.id === routeId && !item.archivedAt);
  const currentPhase = route?.phases.find((phase) => !phase.completedAt);
  if (!route || !currentPhase || currentPhase.id !== phaseId || !currentPhase.actions.some((action) => action.linkedTaskId || action.linkedHabitId)) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 7,
    routes: state.routes.map((item) => item.id !== route.id ? item : {
      ...item,
      updatedAt: now,
      phases: item.phases.map((phase) => phase.id === phaseId ? { ...phase, completedAt: now } : phase),
    }),
    activity: [...state.activity, {
      id: createId("activity"),
      label: "完成路线阶段",
      detail: `${route.name} · ${currentPhase.title}`,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function archivePersonalRoute(state, routeId) {
  const route = validArray(state.routes).find((item) => item.id === routeId && !item.archivedAt);
  if (!route) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 7,
    routes: state.routes.map((item) => item.id === routeId ? { ...item, archivedAt: now, updatedAt: now } : item),
    activity: [...state.activity, {
      id: createId("activity"),
      label: "归档一条个人路线",
      detail: route.name,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function savePersonalBoard(state, input) {
  const now = new Date().toISOString();
  const existing = validArray(state.boards).find((board) => board.id === input?.id);
  if (!existing && validArray(state.boards).length >= MAX_PERSONAL_BOARDS) return state;
  const linkedRouteId = input?.linkedRouteId && validArray(state.routes).some((route) => route.id === input.linkedRouteId && !route.archivedAt)
    ? input.linkedRouteId
    : null;
  const board = sanitizePersonalBoard({
    ...input,
    id: existing?.id || input?.id,
    linkedRouteId,
    records: existing?.records || input?.records || [],
    createdAt: existing?.createdAt || input?.createdAt || now,
    updatedAt: now,
    archivedAt: null,
  });
  if (!board.name || !board.purpose || board.statuses.length < 2 || !board.fields.length) return state;
  return {
    ...state,
    version: 7,
    boards: [...validArray(state.boards).filter((item) => item.id !== board.id), board].slice(-MAX_PERSONAL_BOARDS),
    activity: [...state.activity, {
      id: createId("activity"),
      label: existing ? "调整一个个人业务台" : "建立一个个人业务台",
      detail: `${board.name} · ${board.statuses.length} 个状态 · ${board.fields.length} 个字段`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function addBoardRecord(state, boardId, input, recordActivity = true) {
  const board = validArray(state.boards).find((item) => item.id === boardId && !item.archivedAt);
  const title = cleanText(input?.title, 120);
  if (!board || !title || board.records.length >= MAX_BOARD_RECORDS) return state;
  const statusId = board.statuses.some((status) => status.id === input?.statusId) ? input.statusId : board.statuses[0]?.id;
  if (!statusId) return state;
  const now = new Date().toISOString();
  const record = {
    id: createId("board-record"),
    title,
    statusId,
    values: sanitizeBoardValues(board.fields, input?.values),
    linkedTaskId: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    version: 7,
    boards: state.boards.map((item) => item.id === board.id ? { ...item, updatedAt: now, records: [...item.records, record] } : item),
    activity: recordActivity ? [...state.activity, {
      id: createId("activity"),
      label: "新增一条业务记录",
      detail: `${board.name} · ${record.title}`,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY) : state.activity,
  };
}

export function updateBoardRecord(state, boardId, recordId, input, recordActivity = true) {
  const board = validArray(state.boards).find((item) => item.id === boardId && !item.archivedAt);
  const record = board?.records.find((item) => item.id === recordId);
  if (!board || !record) return state;
  const title = input?.title === undefined ? record.title : cleanText(input.title, 120);
  if (!title) return state;
  const statusId = board.statuses.some((status) => status.id === input?.statusId) ? input.statusId : record.statusId;
  const now = new Date().toISOString();
  const nextRecord = {
    ...record,
    title,
    statusId,
    values: sanitizeBoardValues(board.fields, { ...record.values, ...(input?.values || {}) }),
    updatedAt: now,
  };
  return {
    ...state,
    version: 7,
    boards: state.boards.map((item) => item.id === board.id ? {
      ...item,
      updatedAt: now,
      records: item.records.map((entry) => entry.id === record.id ? nextRecord : entry),
    } : item),
    activity: recordActivity ? [...state.activity, {
      id: createId("activity"),
      label: statusId !== record.statusId ? "推进一条业务记录" : "更新一条业务记录",
      detail: `${board.name} · ${nextRecord.title}`,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY) : state.activity,
  };
}

export function removeBoardRecord(state, boardId, recordId) {
  const board = validArray(state.boards).find((item) => item.id === boardId && !item.archivedAt);
  const record = board?.records.find((item) => item.id === recordId);
  if (!board || !record) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 7,
    boards: state.boards.map((item) => item.id === board.id ? {
      ...item,
      updatedAt: now,
      records: item.records.filter((entry) => entry.id !== recordId),
    } : item),
    activity: [...state.activity, {
      id: createId("activity"),
      label: "移除一条业务记录",
      detail: `${board.name} · ${record.title}`,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function createBoardRecordTask(state, boardId, recordId, recordActivity = true) {
  const board = validArray(state.boards).find((item) => item.id === boardId && !item.archivedAt);
  const record = board?.records.find((item) => item.id === recordId);
  if (!board || !record) return state;
  if (record.linkedTaskId && state.tasks.some((task) => task.id === record.linkedTaskId)) return state;
  const details = board.fields.map((field) => {
    const value = record.values[field.id];
    if (field.type === "checkbox") return value ? `${field.name}：是` : "";
    return value !== "" && value !== 0 ? `${field.name}：${value}` : "";
  }).filter(Boolean);
  let next = addTask(state, {
    title: record.title,
    note: [`来自业务台「${board.name}」`, ...details].join(" · "),
    source: "agent",
  });
  const linkedTaskId = next.tasks.at(-1)?.id || null;
  if (!linkedTaskId) return state;
  const now = new Date().toISOString();
  next = {
    ...next,
    version: 7,
    boards: next.boards.map((item) => item.id === board.id ? {
      ...item,
      updatedAt: now,
      records: item.records.map((entry) => entry.id === record.id ? { ...entry, linkedTaskId, updatedAt: now } : entry),
    } : item),
  };
  if (!recordActivity) return next;
  return {
    ...next,
    activity: [...next.activity, {
      id: createId("activity"),
      label: "从业务台加入任务",
      detail: `${board.name} · ${record.title}`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function archivePersonalBoard(state, boardId) {
  const board = validArray(state.boards).find((item) => item.id === boardId && !item.archivedAt);
  if (!board) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 7,
    boards: state.boards.map((item) => item.id === boardId ? { ...item, archivedAt: now, updatedAt: now } : item),
    activity: [...state.activity, {
      id: createId("activity"),
      label: "归档一个个人业务台",
      detail: board.name,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

function relationTokens(card) {
  const normalized = `${cleanText(card?.title, 120)} ${cleanText(card?.content, 1_200)}`.toLocaleLowerCase("zh-CN");
  const tokens = new Set(normalized.match(/[a-z0-9][a-z0-9-]{2,}/g) || []);
  const chinese = normalized.replace(/[^\p{Script=Han}]/gu, "");
  for (let index = 0; index < chinese.length - 1; index += 1) tokens.add(chinese.slice(index, index + 2));
  return tokens;
}

export function findKnowledgeRelations(cards, limit = 8) {
  const list = validArray(cards).slice(-MAX_KNOWLEDGE_CARDS);
  const tokenCache = new Map(list.map((card) => [card.id, relationTokens(card)]));
  const relations = [];
  for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
      const left = list[leftIndex];
      const right = list[rightIndex];
      if (!left?.id || !right?.id || left.sourceUrl === right.sourceUrl) continue;
      const leftTags = new Map(validArray(left.tags).map((tag) => [cleanText(tag, 24).toLocaleLowerCase("zh-CN"), cleanText(tag, 24)]));
      const sharedTags = validArray(right.tags)
        .map((tag) => cleanText(tag, 24).toLocaleLowerCase("zh-CN"))
        .filter((tag) => tag && leftTags.has(tag))
        .map((tag) => leftTags.get(tag));
      const leftTokens = tokenCache.get(left.id);
      const overlap = [...(tokenCache.get(right.id) || [])].filter((token) => leftTokens?.has(token));
      if (!sharedTags.length && overlap.length < 2) continue;
      const score = sharedTags.length * 4 + Math.min(overlap.length, 4) + 2;
      relations.push({
        id: `${left.id}--${right.id}`,
        leftId: left.id,
        rightId: right.id,
        leftTitle: cleanText(left.title, 120),
        rightTitle: cleanText(right.title, 120),
        leftSourceTitle: cleanText(left.sourceTitle, 240),
        rightSourceTitle: cleanText(right.sourceTitle, 240),
        sharedTags: sharedTags.filter(Boolean),
        sharedTerms: overlap.slice(0, 4),
        score,
      });
    }
  }
  return relations
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(Number(limit) || 0, 24)));
}
