export const WORKBENCH_STORAGE_KEY = "evolve-desk.workspace.v1";

const MAX_TASKS = 120;
const MAX_INBOX_ITEMS = 160;
const MAX_HABITS = 12;
const MAX_ACTIVITY = 80;
const MAX_VIDEOS = 40;
const MAX_KNOWLEDGE_CARDS = 120;
const MAX_KNOWLEDGE_INQUIRIES = 40;

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

export function inboxKind(content) {
  return /^https?:\/\/\S+$/i.test(cleanText(content, 2_000)) ? "link" : "note";
}

export function createInitialWorkbench() {
  return {
    version: 3,
    focusTaskId: null,
    tasks: [],
    inbox: [],
    habits: [],
    activity: [],
    videos: [],
    knowledge: [],
    knowledgeInquiries: [],
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
      platform: ["youtube", "bilibili", "xiaohongshu", "douyin"].includes(video.platform) ? video.platform : "youtube",
      sourceId: cleanText(video.sourceId, 120),
      title: cleanText(video.title, 240),
      author: cleanText(video.author, 120),
      description: cleanText(video.description, 800),
      duration: Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : null,
      thumbnail: cleanText(video.thumbnail, 2_000),
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
    const focusTaskId = tasks.some((task) => task.id === parsed.focusTaskId) ? parsed.focusTaskId : null;
    return { version: 3, focusTaskId, tasks, inbox, habits, activity, videos, knowledge, knowledgeInquiries };
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
    platform: ["youtube", "bilibili", "xiaohongshu", "douyin"].includes(input?.platform) ? input.platform : "youtube",
    sourceId: cleanText(input?.sourceId, 120),
    title,
    author: cleanText(input?.author, 120),
    description: cleanText(input?.description, 800),
    duration: Number.isFinite(input?.duration) ? Math.max(0, Math.round(input.duration)) : null,
    thumbnail: cleanText(input?.thumbnail, 2_000),
    transcriptSource: input?.transcriptSource === "manual"
      ? "manual"
      : input?.transcriptSource === "local-whisper" ? "local-whisper" : "platform",
    summary,
    createdAt: existing?.createdAt || now,
  };
  let next = {
    ...state,
    version: 3,
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
    version: 3,
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
