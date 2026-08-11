export const WORKBENCH_STORAGE_KEY = "evolve-desk.workspace.v1";

const MAX_TASKS = 120;
const MAX_INBOX_ITEMS = 160;
const MAX_HABITS = 12;
const MAX_ACTIVITY = 80;
const MAX_VIDEOS = 40;
const MAX_KNOWLEDGE_CARDS = 120;
const MAX_KNOWLEDGE_INQUIRIES = 40;
const MAX_LEARNING_TOPICS = 24;
const MAX_TOPIC_SOURCES = 16;
const MAX_TOPIC_NODES = 8;
const MAX_STUDY_CARDS = 240;
const MAX_STUDY_ATTEMPTS = 800;
const MAX_WEEKLY_REVIEWS = 24;
const MAX_PERSONAL_ROUTES = 12;
const MAX_ROUTE_PHASES = 6;
const MAX_ROUTE_ACTIONS = 5;
const MAX_PERSONAL_BOARDS = 10;
const MAX_BOARD_STATUSES = 6;
const MAX_BOARD_FIELDS = 6;
const MAX_BOARD_RECORDS = 80;
const MAX_CREATOR_SIGNALS = 40;
const MAX_CREATOR_IDEAS = 80;
const MAX_CREATOR_REVIEWS = 60;
const MAX_CREATOR_STEPS = 6;

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
    version: 11,
    focusTaskId: null,
    tasks: [],
    inbox: [],
    habits: [],
    activity: [],
    videos: [],
    knowledge: [],
    knowledgeInquiries: [],
    learningTopics: [],
    weeklyReviews: [],
    routes: [],
    boards: [],
    creator: {
      profile: { niche: "", audience: "", voice: "", platforms: [], updatedAt: "" },
      signals: [],
      ideas: [],
      reviews: [],
    },
    study: { cards: [], attempts: [] },
  };
}

function validArray(value) {
  return Array.isArray(value) ? value : [];
}

function dedupeRecordIds(items, prefix) {
  const seen = new Set();
  return items.map((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    const id = createId(prefix);
    seen.add(id);
    return { ...item, id };
  });
}

function sanitizeVisualEvidence(value) {
  const seen = new Set();
  return validArray(value).slice(0, 8).map((frame) => {
    const seconds = Number(frame?.seconds);
    return {
      id: cleanText(frame?.id, 100),
      seconds: Number.isFinite(seconds) ? Math.min(2 * 60 * 60, Math.max(0, Math.round(seconds))) : 0,
      timestamp: cleanText(frame?.timestamp, 16),
      ocrText: cleanText(frame?.ocrText, 1_200),
      modelText: cleanText(frame?.modelText, 1_200),
      observation: cleanText(frame?.observation, 600),
      uncertainty: cleanText(frame?.uncertainty, 300),
    };
  }).filter((frame) => {
    if (!frame.id || seen.has(frame.id)) return false;
    seen.add(frame.id);
    return true;
  });
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
    visualFindings: validArray(value.visualFindings).slice(0, 8).map((finding) => ({
      frameId: cleanText(finding?.frameId, 100),
      timestamp: cleanText(finding?.timestamp, 16),
      observation: cleanText(finding?.observation, 600),
    })).filter((finding) => finding.frameId && finding.observation),
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
      evidenceFrameIds: [...new Set(validArray(card?.evidenceFrameIds).slice(0, 4).map((id) => cleanText(id, 100)).filter(Boolean))],
    })).filter((card) => card.title && card.content),
  };
}

function bindSummaryVisualEvidence(summary, frames) {
  const value = sanitizeVideoSummary(summary);
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  return {
    ...value,
    visualFindings: value.visualFindings.filter((finding) => frameById.has(finding.frameId)).map((finding) => ({
      ...finding,
      timestamp: frameById.get(finding.frameId).timestamp,
    })),
    cards: value.cards.map((card) => ({
      ...card,
      evidenceFrameIds: card.evidenceFrameIds.filter((id) => frameById.has(id)),
    })),
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

function learningSourceKey(source) {
  const kind = source?.kind === "video" ? "video" : source?.kind === "knowledge" ? "knowledge" : "";
  const id = cleanText(source?.id, 100);
  return kind && id ? `${kind}:${id}` : "";
}

function createLearningSourceIndex(videos, knowledge) {
  return new Map([
    ...validArray(videos).map((video) => [`video:${video.id}`, { kind: "video", id: video.id }]),
    ...validArray(knowledge).map((card) => [`knowledge:${card.id}`, { kind: "knowledge", id: card.id }]),
  ]);
}

function sanitizeLearningMap(map, sourceIndex, topicSources) {
  if (!map || typeof map !== "object") return null;
  const allowedSourceKeys = new Set(topicSources.map(learningSourceKey));
  const seenNodeIds = new Set();
  const nodes = validArray(map.nodes).slice(0, MAX_TOPIC_NODES).map((node) => {
    const id = cleanText(node?.id, 100) || createId("topic-node");
    if (seenNodeIds.has(id)) return null;
    seenNodeIds.add(id);
    const sourceRefs = [];
    const seenSources = new Set();
    for (const source of validArray(node?.sourceRefs).slice(0, 6)) {
      const key = learningSourceKey(source);
      const canonical = sourceIndex.get(key);
      if (!canonical || !allowedSourceKeys.has(key) || seenSources.has(key)) continue;
      seenSources.add(key);
      sourceRefs.push(canonical);
    }
    return {
      id,
      kind: ["idea", "method", "evidence", "contrast"].includes(node?.kind) ? node.kind : "idea",
      title: cleanText(node?.title, 100),
      summary: cleanText(node?.summary, 600),
      sourceRefs,
    };
  }).filter((node) => node && node.title && node.summary && node.sourceRefs.length);
  if (nodes.length < 2) return null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenEdges = new Set();
  const edges = validArray(map.edges).slice(0, 12).map((edge) => {
    const from = cleanText(edge?.from, 100);
    const to = cleanText(edge?.to, 100);
    const relation = ["supports", "extends", "contrasts", "depends_on"].includes(edge?.relation) ? edge.relation : "extends";
    return { from, to, relation, label: cleanText(edge?.label, 80) };
  }).filter((edge) => {
    const key = `${edge.from}:${edge.to}:${edge.relation}`;
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to || seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });
  const seenQuestions = new Set();
  const openQuestions = validArray(map.openQuestions).slice(0, 5).map((question) => {
    let id = cleanText(question?.id, 100) || createId("topic-question");
    if (seenQuestions.has(id)) id = createId("topic-question");
    seenQuestions.add(id);
    return {
      id,
      question: cleanText(question?.question, 360),
      reason: cleanText(question?.reason, 360),
    };
  }).filter((question) => question.question && question.reason);
  const thesis = cleanText(map.thesis, 600);
  return thesis ? { thesis, nodes, edges, openQuestions } : null;
}

function learningMapNodeKey(node) {
  return cleanText(node?.title, 100).toLocaleLowerCase("zh-CN");
}

function learningMapNodeFingerprint(node) {
  return JSON.stringify({
    kind: ["idea", "method", "evidence", "contrast"].includes(node?.kind) ? node.kind : "idea",
    summary: cleanText(node?.summary, 600),
    sources: validArray(node?.sourceRefs).map(learningSourceKey).filter(Boolean).sort(),
  });
}

export function compareLearningMaps(previous, next) {
  const previousValue = previous && typeof previous === "object" ? previous : {};
  const nextValue = next && typeof next === "object" ? next : {};
  const previousNodes = validArray(previousValue.nodes).filter((node) => learningMapNodeKey(node));
  const nextNodes = validArray(nextValue.nodes).filter((node) => learningMapNodeKey(node));
  const previousIndex = new Map(previousNodes.map((node) => [learningMapNodeKey(node), node]));
  const nextIndex = new Map(nextNodes.map((node) => [learningMapNodeKey(node), node]));
  const added = nextNodes.filter((node) => !previousIndex.has(learningMapNodeKey(node))).map((node) => cleanText(node.title, 100));
  const removed = previousNodes.filter((node) => !nextIndex.has(learningMapNodeKey(node))).map((node) => cleanText(node.title, 100));
  const changed = nextNodes.filter((node) => {
    const oldNode = previousIndex.get(learningMapNodeKey(node));
    return oldNode && learningMapNodeFingerprint(oldNode) !== learningMapNodeFingerprint(node);
  }).map((node) => cleanText(node.title, 100));
  const preserved = nextNodes.filter((node) => {
    const oldNode = previousIndex.get(learningMapNodeKey(node));
    return oldNode && learningMapNodeFingerprint(oldNode) === learningMapNodeFingerprint(node);
  }).map((node) => cleanText(node.title, 100));
  return {
    added,
    removed,
    changed,
    preserved,
    thesisChanged: cleanText(previousValue.thesis, 600) !== cleanText(nextValue.thesis, 600),
  };
}

function sanitizeLearningTopic(topic, sourceIndex) {
  const value = topic && typeof topic === "object" ? topic : {};
  const sources = [];
  const seenSources = new Set();
  for (const source of validArray(value.sources).slice(0, MAX_TOPIC_SOURCES)) {
    const key = learningSourceKey(source);
    const canonical = sourceIndex.get(key);
    if (!canonical || seenSources.has(key)) continue;
    seenSources.add(key);
    sources.push(canonical);
  }
  const now = new Date().toISOString();
  return {
    id: cleanText(value.id, 100) || createId("learning-topic"),
    title: cleanText(value.title, 100),
    goal: cleanText(value.goal, 500),
    sources,
    map: sanitizeLearningMap(value.map, sourceIndex, sources),
    createdAt: cleanText(value.createdAt, 40) || now,
    updatedAt: cleanText(value.updatedAt, 40) || now,
  };
}

function validIso(value, fallback = "") {
  const cleaned = cleanText(value, 40);
  return Number.isFinite(new Date(cleaned).getTime()) ? cleaned : fallback;
}

function sanitizeStudySource(source) {
  const value = source && typeof source === "object" ? source : {};
  return {
    cardId: cleanText(value.cardId, 100),
    cardTitle: cleanText(value.cardTitle, 120),
    sourceTitle: cleanText(value.sourceTitle, 240),
    sourceUrl: cleanText(value.sourceUrl, 2_000),
  };
}

function sanitizeStudyCard(card) {
  const value = card && typeof card === "object" ? card : {};
  const createdAt = validIso(value.createdAt, new Date().toISOString());
  const answer = cleanText(value.answer, 1_200);
  const rawOptions = [...new Set(validArray(value.options).slice(0, 5).map((item) => cleanText(item, 240)).filter(Boolean))];
  const isChoice = value.kind === "multiple_choice" && rawOptions.length >= 2 && rawOptions.includes(answer);
  return {
    id: cleanText(value.id, 100) || createId("study-card"),
    kind: isChoice ? "multiple_choice" : "recall",
    prompt: cleanText(value.prompt, 500),
    answer,
    explanation: cleanText(value.explanation, 1_200),
    options: isChoice ? rawOptions : [],
    tags: [...new Set(validArray(value.tags).slice(0, 6).map((tag) => cleanText(tag, 24)).filter(Boolean))],
    sources: validArray(value.sources).slice(0, 8).map(sanitizeStudySource).filter((source) => source.cardId && source.cardTitle),
    dueAt: validIso(value.dueAt, createdAt),
    intervalDays: Number.isFinite(value.intervalDays) ? Math.max(0, Math.min(36_500, Math.round(value.intervalDays))) : 0,
    easeFactor: Number.isFinite(value.easeFactor) ? Math.max(1.3, Math.min(3, Number(value.easeFactor))) : 2.5,
    reviewCount: Number.isFinite(value.reviewCount) ? Math.max(0, Math.min(100_000, Math.round(value.reviewCount))) : 0,
    lapseCount: Number.isFinite(value.lapseCount) ? Math.max(0, Math.min(100_000, Math.round(value.lapseCount))) : 0,
    suspended: Boolean(value.suspended),
    createdAt,
    updatedAt: validIso(value.updatedAt, createdAt),
    lastReviewedAt: value.lastReviewedAt ? validIso(value.lastReviewedAt, null) : null,
  };
}

function sanitizeStudyAttempt(attempt) {
  const value = attempt && typeof attempt === "object" ? attempt : {};
  const reviewedAt = validIso(value.reviewedAt, new Date().toISOString());
  return {
    id: cleanText(value.id, 100) || createId("study-attempt"),
    cardId: cleanText(value.cardId, 100),
    cardPrompt: cleanText(value.cardPrompt, 500),
    rating: ["again", "hard", "good", "easy"].includes(value.rating) ? value.rating : "again",
    selectedAnswer: cleanText(value.selectedAnswer, 240),
    correct: typeof value.correct === "boolean" ? value.correct : null,
    previousIntervalDays: Number.isFinite(value.previousIntervalDays) ? Math.max(0, Math.round(value.previousIntervalDays)) : 0,
    nextIntervalDays: Number.isFinite(value.nextIntervalDays) ? Math.max(0, Math.round(value.nextIntervalDays)) : 0,
    reviewedAt,
    nextDueAt: validIso(value.nextDueAt, reviewedAt),
  };
}

function sanitizeStudyState(study) {
  const value = study && typeof study === "object" ? study : {};
  const cards = dedupeRecordIds(validArray(value.cards).slice(-MAX_STUDY_CARDS).map(sanitizeStudyCard).filter((card) => card.prompt && card.answer), "study-card");
  const cardIds = new Set(cards.map((card) => card.id));
  return {
    cards,
    attempts: dedupeRecordIds(validArray(value.attempts).slice(-MAX_STUDY_ATTEMPTS).map(sanitizeStudyAttempt).filter((attempt) => attempt.cardId && attempt.cardPrompt && cardIds.has(attempt.cardId)), "study-attempt"),
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
      visualFrames: safeCount(stats.visualFrames),
      knowledgeCards: safeCount(stats.knowledgeCards),
      knowledgeInquiries: safeCount(stats.knowledgeInquiries),
      learningTopics: safeCount(stats.learningTopics),
      creatorIdeas: safeCount(stats.creatorIdeas),
      creatorReviews: safeCount(stats.creatorReviews),
      studyCardsCreated: safeCount(stats.studyCardsCreated),
      studyReviews: safeCount(stats.studyReviews),
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

function safeCreatorMetric(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1_000_000_000_000, Math.max(0, Math.round(number))) : 0;
}

function sanitizeCreatorProfile(profile) {
  const value = profile && typeof profile === "object" ? profile : {};
  return {
    niche: cleanText(value.niche, 120),
    audience: cleanText(value.audience, 220),
    voice: cleanText(value.voice, 220),
    platforms: [...new Set(validArray(value.platforms).slice(0, 8).map((platform) => cleanText(platform, 30)).filter(Boolean))],
    updatedAt: cleanText(value.updatedAt, 40),
  };
}

function sanitizeCreatorSignal(signal) {
  const value = signal && typeof signal === "object" ? signal : {};
  const now = new Date().toISOString();
  const observedAt = cleanText(value.observedAt, 10);
  return {
    id: cleanText(value.id, 100) || createId("creator-signal"),
    title: cleanText(value.title, 120),
    url: cleanText(value.url, 2_000),
    note: cleanText(value.note, 600),
    platform: cleanText(value.platform, 30),
    observedAt: /^\d{4}-\d{2}-\d{2}$/.test(observedAt) ? observedAt : "",
    createdAt: cleanText(value.createdAt, 40) || now,
  };
}

function sanitizeCreatorSourceRef(source) {
  const value = source && typeof source === "object" ? source : {};
  return {
    kind: ["video", "knowledge", "signal"].includes(value.kind) ? value.kind : "signal",
    id: cleanText(value.id, 100),
    title: cleanText(value.title, 180),
    url: cleanText(value.url, 2_000),
    evidence: cleanText(value.evidence, 1_000),
  };
}

function sanitizeCreatorIdea(idea) {
  const value = idea && typeof idea === "object" ? idea : {};
  const now = new Date().toISOString();
  const seenStepIds = new Set();
  const steps = validArray(value.steps).slice(0, MAX_CREATOR_STEPS).map((step) => {
    let id = cleanText(step?.id, 100) || createId("creator-step");
    if (seenStepIds.has(id)) id = createId("creator-step");
    seenStepIds.add(id);
    return {
      id,
      title: cleanText(step?.title, 120),
      note: cleanText(step?.note, 320),
      done: Boolean(step?.done),
    };
  }).filter((step) => step.title);
  const seenSourceRefs = new Set();
  const sourceRefs = validArray(value.sourceRefs).slice(0, 8).map(sanitizeCreatorSourceRef).filter((source) => {
    const key = `${source.kind}:${source.id}`;
    if (!source.id || !source.title || !source.evidence || seenSourceRefs.has(key)) return false;
    seenSourceRefs.add(key);
    return true;
  });
  return {
    id: cleanText(value.id, 100) || createId("creator-idea"),
    title: cleanText(value.title, 120),
    promise: cleanText(value.promise, 300),
    hook: cleanText(value.hook, 300),
    angle: cleanText(value.angle, 500),
    format: ["video", "graphic", "article", "live"].includes(value.format) ? value.format : "video",
    platform: cleanText(value.platform, 30),
    sourceRefs,
    originalityGuard: cleanText(value.originalityGuard, 500),
    reflection: cleanText(value.reflection, 500),
    steps,
    status: ["idea", "drafting", "producing", "published"].includes(value.status) ? value.status : "idea",
    linkedTaskId: value.linkedTaskId ? cleanText(value.linkedTaskId, 100) : null,
    linkedBoardId: value.linkedBoardId ? cleanText(value.linkedBoardId, 100) : null,
    linkedBoardRecordId: value.linkedBoardRecordId ? cleanText(value.linkedBoardRecordId, 100) : null,
    createdAt: cleanText(value.createdAt, 40) || now,
    updatedAt: cleanText(value.updatedAt, 40) || now,
  };
}

function sanitizeCreatorReviewAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return null;
  const metricKeys = new Set(["views", "likes", "comments", "saves", "shares", "follows"]);
  const observations = validArray(analysis.observations).slice(0, 5).map((observation) => ({
    claim: cleanText(observation?.claim, 420),
    metricKeys: [...new Set(validArray(observation?.metricKeys).filter((key) => metricKeys.has(key)))].slice(0, 6),
  })).filter((observation) => observation.claim && observation.metricKeys.length);
  const hypotheses = validArray(analysis.hypotheses).slice(0, 4).map((hypothesis) => ({
    idea: cleanText(hypothesis?.idea, 420),
    confidence: hypothesis?.confidence === "medium" ? "medium" : "low",
  })).filter((hypothesis) => hypothesis.idea);
  const nextExperiment = analysis.nextExperiment && typeof analysis.nextExperiment === "object" ? {
    change: cleanText(analysis.nextExperiment.change, 300),
    reason: cleanText(analysis.nextExperiment.reason, 360),
    successSignal: cleanText(analysis.nextExperiment.successSignal, 300),
  } : { change: "", reason: "", successSignal: "" };
  const value = {
    headline: cleanText(analysis.headline, 120),
    observations,
    hypotheses,
    gaps: validArray(analysis.gaps).slice(0, 5).map((gap) => cleanText(gap, 360)).filter(Boolean),
    nextExperiment,
    reflection: cleanText(analysis.reflection, 500),
  };
  return value.headline && value.nextExperiment.change ? value : null;
}

function sanitizeCreatorReview(review) {
  const value = review && typeof review === "object" ? review : {};
  const now = new Date().toISOString();
  const publishedAt = cleanText(value.publishedAt, 10);
  return {
    id: cleanText(value.id, 100) || createId("creator-review"),
    ideaId: value.ideaId ? cleanText(value.ideaId, 100) : null,
    title: cleanText(value.title, 120),
    platform: cleanText(value.platform, 30),
    url: cleanText(value.url, 2_000),
    publishedAt: /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? publishedAt : "",
    metrics: {
      views: safeCreatorMetric(value.metrics?.views),
      likes: safeCreatorMetric(value.metrics?.likes),
      comments: safeCreatorMetric(value.metrics?.comments),
      saves: safeCreatorMetric(value.metrics?.saves),
      shares: safeCreatorMetric(value.metrics?.shares),
      follows: safeCreatorMetric(value.metrics?.follows),
    },
    notes: cleanText(value.notes, 1_200),
    analysis: sanitizeCreatorReviewAnalysis(value.analysis),
    createdAt: cleanText(value.createdAt, 40) || now,
    updatedAt: cleanText(value.updatedAt, 40) || now,
  };
}

function sanitizeCreatorStudio(creator) {
  const value = creator && typeof creator === "object" ? creator : {};
  return {
    profile: sanitizeCreatorProfile(value.profile),
    signals: dedupeRecordIds(validArray(value.signals).slice(-MAX_CREATOR_SIGNALS).map(sanitizeCreatorSignal).filter((signal) => signal.title && signal.note), "creator-signal"),
    ideas: dedupeRecordIds(validArray(value.ideas).slice(-MAX_CREATOR_IDEAS).map(sanitizeCreatorIdea).filter((idea) => idea.title && idea.promise && idea.hook && idea.steps.length), "creator-idea"),
    reviews: dedupeRecordIds(validArray(value.reviews).slice(-MAX_CREATOR_REVIEWS).map(sanitizeCreatorReview).filter((review) => review.title && review.platform), "creator-review"),
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
    const videos = validArray(parsed.videos).slice(-MAX_VIDEOS).map((video) => {
      const visualEvidence = sanitizeVisualEvidence(video.visualEvidence);
      return {
        id: cleanText(video.id, 100) || createId("video"),
        url: cleanText(video.url, 2_000),
        platform: ["youtube", "bilibili", "xiaohongshu", "douyin", "local"].includes(video.platform) ? video.platform : "youtube",
        sourceId: cleanText(video.sourceId, 120),
        title: cleanText(video.title, 240),
        author: cleanText(video.author, 120),
        description: cleanText(video.description, 800),
        duration: Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : null,
        thumbnail: cleanText(video.thumbnail, 2_000),
        hasVideo: typeof video.hasVideo === "boolean" ? video.hasVideo : video.platform !== "local" || /\.(?:mkv|mov|mp4|webm)$/i.test(cleanText(video.localFileName, 180)),
        width: Number.isFinite(video.width) ? Math.max(0, Math.round(video.width)) : 0,
        height: Number.isFinite(video.height) ? Math.max(0, Math.round(video.height)) : 0,
        localFileName: cleanText(video.localFileName, 180),
        transcriptSource: video.transcriptSource === "manual"
          ? "manual"
          : video.transcriptSource === "local-whisper" ? "local-whisper" : "platform",
        visualEvidence,
        summary: bindSummaryVisualEvidence(video.summary, visualEvidence),
        createdAt: cleanText(video.createdAt, 40) || new Date().toISOString(),
      };
    }).filter((video) => video.url && video.title && video.summary.oneSentence);
    const visualIdsBySource = new Map(videos.map((video) => [video.url, new Set(video.visualEvidence.map((frame) => frame.id))]));
    const knowledge = validArray(parsed.knowledge).slice(-MAX_KNOWLEDGE_CARDS).map((card) => ({
      id: cleanText(card.id, 100) || createId("knowledge"),
      title: cleanText(card.title, 120),
      content: cleanText(card.content, 1_200),
      tags: validArray(card.tags).slice(0, 5).map((tag) => cleanText(tag, 24)).filter(Boolean),
      sourceUrl: cleanText(card.sourceUrl, 2_000),
      sourceTitle: cleanText(card.sourceTitle, 240),
      evidenceFrameIds: [...new Set(validArray(card.evidenceFrameIds).slice(0, 4).map((id) => cleanText(id, 100)).filter((id) => visualIdsBySource.get(cleanText(card.sourceUrl, 2_000))?.has(id)))],
      createdAt: cleanText(card.createdAt, 40) || new Date().toISOString(),
    })).filter((card) => card.title && card.content);
    const knowledgeInquiries = validArray(parsed.knowledgeInquiries)
      .slice(-MAX_KNOWLEDGE_INQUIRIES)
      .map(sanitizeKnowledgeInquiry)
      .filter((inquiry) => inquiry.question && inquiry.answer);
    const learningSourceIndex = createLearningSourceIndex(videos, knowledge);
    const learningTopics = validArray(parsed.learningTopics)
      .slice(-MAX_LEARNING_TOPICS)
      .map((topic) => sanitizeLearningTopic(topic, learningSourceIndex))
      .filter((topic) => topic.title && topic.goal && topic.sources.length >= 2);
    const studyBase = sanitizeStudyState(parsed.study);
    const knowledgeById = new Map(knowledge.map((card) => [card.id, card]));
    const study = {
      ...studyBase,
      cards: studyBase.cards.map((card) => ({
        ...card,
        sources: card.sources.map((source) => knowledgeById.get(source.cardId)).filter(Boolean).map((source) => ({
          cardId: source.id,
          cardTitle: source.title,
          sourceTitle: source.sourceTitle,
          sourceUrl: source.sourceUrl,
        })),
      })),
    };
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
    const creatorBase = sanitizeCreatorStudio(parsed.creator);
    const boardById = new Map(boards.map((board) => [board.id, board]));
    const creator = {
      ...creatorBase,
      ideas: creatorBase.ideas.map((idea) => {
        const linkedBoard = idea.linkedBoardId ? boardById.get(idea.linkedBoardId) : null;
        const boardLinkValid = Boolean(linkedBoard && linkedBoard.records.some((record) => record.id === idea.linkedBoardRecordId));
        return {
          ...idea,
          linkedTaskId: idea.linkedTaskId && taskIds.has(idea.linkedTaskId) ? idea.linkedTaskId : null,
          linkedBoardId: boardLinkValid ? idea.linkedBoardId : null,
          linkedBoardRecordId: boardLinkValid ? idea.linkedBoardRecordId : null,
        };
      }),
      reviews: creatorBase.reviews.map((review) => creatorBase.ideas.some((idea) => idea.id === review.ideaId) ? review : { ...review, ideaId: null }),
    };
    const focusTaskId = tasks.some((task) => task.id === parsed.focusTaskId) ? parsed.focusTaskId : null;
    return { version: 11, focusTaskId, tasks, inbox, habits, activity, videos, knowledge, knowledgeInquiries, learningTopics, weeklyReviews, routes, boards, creator, study };
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
    } else if (rawAction?.type === "advance_creator_idea") {
      next = updateCreatorIdea(next, rawAction.ideaId, { status: rawAction.status }, false);
    } else if (rawAction?.type === "create_creator_task") {
      next = createCreatorIdeaTask(next, rawAction.ideaId, false);
    } else if (rawAction?.type === "create_study_task") {
      next = createStudyReviewTask(next, rawAction.cardIds, false);
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
  const visualEvidence = sanitizeVisualEvidence(input?.visualEvidence);
  const summary = bindSummaryVisualEvidence(input?.summary, visualEvidence);
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
    hasVideo: Boolean(input?.hasVideo),
    width: Number.isFinite(input?.width) ? Math.max(0, Math.round(input.width)) : 0,
    height: Number.isFinite(input?.height) ? Math.max(0, Math.round(input.height)) : 0,
    localFileName: cleanText(input?.localFileName, 180),
    transcriptSource: input?.transcriptSource === "manual"
      ? "manual"
      : input?.transcriptSource === "local-whisper" ? "local-whisper" : "platform",
    visualEvidence,
    summary,
    createdAt: existing?.createdAt || now,
  };
  let next = {
    ...state,
    version: 11,
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
  const availableKnowledgeIds = new Set(next.knowledge.map((card) => card.id));
  const nextStudy = sanitizeStudyState(next.study);
  next = {
    ...next,
    study: {
      ...nextStudy,
      cards: nextStudy.cards.map((card) => ({
        ...card,
        sources: card.sources.filter((source) => availableKnowledgeIds.has(source.cardId)),
      })),
    },
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
    version: 11,
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

export function saveLearningTopic(state, input, actor = "human") {
  const sourceIndex = createLearningSourceIndex(state.videos, state.knowledge);
  const existing = validArray(state.learningTopics).find((topic) => topic.id === cleanText(input?.id, 100));
  const now = new Date().toISOString();
  const topic = sanitizeLearningTopic({
    ...existing,
    ...input,
    id: existing?.id || cleanText(input?.id, 100) || undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }, sourceIndex);
  if (!topic.title || topic.goal.length < 4 || topic.sources.length < 2) return state;
  if (existing?.map && !topic.map) return state;
  const mapped = Boolean(topic.map);
  return {
    ...state,
    version: 11,
    learningTopics: [
      ...validArray(state.learningTopics).filter((item) => item.id !== topic.id),
      topic,
    ].slice(-MAX_LEARNING_TOPICS),
    activity: [...state.activity, {
      id: createId("activity"),
      label: mapped ? "保存学习专题脉络" : existing ? "更新学习专题资料" : "建立多来源学习专题",
      detail: `${topic.title} · ${topic.sources.length} 条资料${mapped ? ` · ${topic.map.nodes.length} 个有据节点` : ""}`,
      createdAt: now,
      source: actor === "agent" ? "agent" : "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function removeLearningTopic(state, topicId) {
  const topic = validArray(state.learningTopics).find((item) => item.id === topicId);
  if (!topic) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 11,
    learningTopics: state.learningTopics.filter((item) => item.id !== topicId),
    activity: [...state.activity, {
      id: createId("activity"),
      label: "移除学习专题",
      detail: topic.title,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

function studySourceIndex(state) {
  return new Map(validArray(state.knowledge).map((card) => [card.id, {
    cardId: cleanText(card.id, 100),
    cardTitle: cleanText(card.title, 120),
    sourceTitle: cleanText(card.sourceTitle, 240),
    sourceUrl: cleanText(card.sourceUrl, 2_000),
  }]));
}

export function saveStudyCards(state, drafts, actor = "agent") {
  const study = sanitizeStudyState(state.study);
  const sourceIndex = studySourceIndex(state);
  const now = new Date().toISOString();
  let cards = [...study.cards];
  let savedCount = 0;
  for (const rawDraft of validArray(drafts).slice(0, 12)) {
    const existing = cards.find((card) => card.id === rawDraft?.id);
    const sources = validArray(rawDraft?.sources).map((source) => sourceIndex.get(cleanText(source?.cardId, 100))).filter(Boolean);
    const card = sanitizeStudyCard({
      ...rawDraft,
      id: existing?.id || undefined,
      sources,
      dueAt: existing?.dueAt || now,
      intervalDays: existing?.intervalDays || 0,
      easeFactor: existing?.easeFactor || 2.5,
      reviewCount: existing?.reviewCount || 0,
      lapseCount: existing?.lapseCount || 0,
      suspended: existing?.suspended || false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastReviewedAt: existing?.lastReviewedAt || null,
    });
    if (!card.prompt || !card.answer) continue;
    const duplicate = cards.find((item) => item.id !== card.id && item.prompt.toLocaleLowerCase("zh-CN") === card.prompt.toLocaleLowerCase("zh-CN"));
    if (duplicate) continue;
    cards = [...cards.filter((item) => item.id !== card.id), card].slice(-MAX_STUDY_CARDS);
    savedCount += 1;
  }
  if (!savedCount) return state;
  return {
    ...state,
    version: 11,
    study: { ...study, cards },
    activity: [...state.activity, {
      id: createId("activity"),
      label: actor === "human" ? "手动保存复习卡" : "从知识生成复习卡",
      detail: `保存 ${savedCount} 张卡片 · 已进入到期队列`,
      createdAt: now,
      source: actor === "human" ? "human" : "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function getDueStudyCards(state, now = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return sanitizeStudyState(state.study).cards
    .filter((card) => !card.suspended && new Date(card.dueAt).getTime() <= timestamp)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() || left.createdAt.localeCompare(right.createdAt));
}

export function rateStudyCard(state, cardId, rating, selectedAnswer = "", reviewedAt = new Date()) {
  if (!["again", "hard", "good", "easy"].includes(rating)) return state;
  const study = sanitizeStudyState(state.study);
  const card = study.cards.find((item) => item.id === cardId && !item.suspended);
  if (!card) return state;
  const now = reviewedAt instanceof Date ? new Date(reviewedAt) : new Date(reviewedAt);
  if (!Number.isFinite(now.getTime())) return state;
  const previousIntervalDays = card.intervalDays;
  let nextIntervalDays = 0;
  let easeFactor = card.easeFactor;
  let nextDue = new Date(now);
  if (rating === "again") {
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    nextDue = new Date(now.getTime() + 10 * 60 * 1_000);
  } else if (rating === "hard") {
    easeFactor = Math.max(1.3, easeFactor - 0.15);
    nextIntervalDays = card.reviewCount === 0 ? 1 : Math.max(1, Math.ceil(Math.max(1, card.intervalDays) * 1.2));
    nextDue.setDate(nextDue.getDate() + nextIntervalDays);
  } else if (rating === "good") {
    nextIntervalDays = card.reviewCount === 0 ? 1 : card.reviewCount === 1 ? 3 : Math.max(1, Math.round(Math.max(1, card.intervalDays) * easeFactor));
    nextDue.setDate(nextDue.getDate() + nextIntervalDays);
  } else {
    easeFactor = Math.min(3, easeFactor + 0.15);
    nextIntervalDays = card.reviewCount === 0 ? 4 : Math.max(2, Math.round(Math.max(1, card.intervalDays) * easeFactor * 1.3));
    nextDue.setDate(nextDue.getDate() + nextIntervalDays);
  }
  const reviewedAtIso = now.toISOString();
  const nextDueAt = nextDue.toISOString();
  const answer = cleanText(selectedAnswer, 240);
  const correct = card.kind === "multiple_choice" && answer ? answer === card.answer : null;
  const updatedCard = sanitizeStudyCard({
    ...card,
    intervalDays: nextIntervalDays,
    easeFactor,
    reviewCount: card.reviewCount + 1,
    lapseCount: card.lapseCount + (rating === "again" ? 1 : 0),
    dueAt: nextDueAt,
    updatedAt: reviewedAtIso,
    lastReviewedAt: reviewedAtIso,
  });
  const attempt = sanitizeStudyAttempt({
    id: createId("study-attempt"),
    cardId: card.id,
    cardPrompt: card.prompt,
    rating,
    selectedAnswer: answer,
    correct,
    previousIntervalDays,
    nextIntervalDays,
    reviewedAt: reviewedAtIso,
    nextDueAt,
  });
  return {
    ...state,
    version: 11,
    study: {
      cards: study.cards.map((item) => item.id === card.id ? updatedCard : item),
      attempts: [...study.attempts, attempt].slice(-MAX_STUDY_ATTEMPTS),
    },
    activity: [...state.activity, {
      id: createId("activity"),
      label: "完成一张到期复习卡",
      detail: `${card.prompt} · ${rating}`,
      createdAt: reviewedAtIso,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function removeStudyCard(state, cardId) {
  const study = sanitizeStudyState(state.study);
  const card = study.cards.find((item) => item.id === cardId);
  if (!card) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 11,
    study: {
      cards: study.cards.filter((item) => item.id !== cardId),
      attempts: study.attempts.filter((attempt) => attempt.cardId !== cardId),
    },
    activity: [...state.activity, {
      id: createId("activity"),
      label: "移除一张复习卡",
      detail: card.prompt,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function toggleStudyCardSuspended(state, cardId) {
  const study = sanitizeStudyState(state.study);
  const card = study.cards.find((item) => item.id === cardId);
  if (!card) return state;
  const now = new Date().toISOString();
  const suspended = !card.suspended;
  return {
    ...state,
    version: 11,
    study: { ...study, cards: study.cards.map((item) => item.id === cardId ? { ...item, suspended, updatedAt: now } : item) },
    activity: [...state.activity, {
      id: createId("activity"),
      label: suspended ? "暂停一张复习卡" : "恢复一张复习卡",
      detail: card.prompt,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function createStudyReviewTask(state, cardIds, recordActivity = true, now = new Date()) {
  const dueById = new Map(getDueStudyCards(state, now).map((card) => [card.id, card]));
  const cards = [...new Set(validArray(cardIds).slice(0, 20).map((id) => cleanText(id, 100)))].map((id) => dueById.get(id)).filter(Boolean);
  if (!cards.length) return state;
  const title = `复习 ${cards.length} 张到期卡片`;
  if (state.tasks.some((task) => !task.done && task.title === title)) return state;
  let next = addTask(state, {
    title,
    note: `来自记忆复习 · ${cards.slice(0, 3).map((card) => card.prompt).join("；")}${cards.length > 3 ? "…" : ""}`,
    source: "agent",
  });
  if (!recordActivity) return next;
  const createdAt = new Date().toISOString();
  return {
    ...next,
    activity: [...next.activity, {
      id: createId("activity"),
      label: "把到期复习加入任务",
      detail: title,
      createdAt,
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
      visualFrames: 0,
      knowledgeCards: 0,
      inquiries: 0,
      learningTopics: 0,
      creatorIdeas: 0,
      creatorReviews: 0,
      studyCardsCreated: 0,
      studyReviews: 0,
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
  const learningTopics = validArray(state.learningTopics).filter((topic) => dateInRange(topic.updatedAt, start, end));
  const creator = sanitizeCreatorStudio(state.creator);
  const creatorIdeas = creator.ideas.filter((idea) => dateInRange(idea.createdAt, start, end));
  const creatorReviews = creator.reviews.filter((review) => dateInRange(review.createdAt, start, end));
  const study = sanitizeStudyState(state.study);
  const studyCards = study.cards.filter((card) => dateInRange(card.createdAt, start, end));
  const studyAttempts = study.attempts.filter((attempt) => dateInRange(attempt.reviewedAt, start, end));
  const activity = validArray(state.activity).filter((entry) => dateInRange(entry.createdAt, start, end));

  for (const task of tasksCreated) dayForTimestamp(task.createdAt).tasksCreated += 1;
  for (const task of completedTasks) dayForTimestamp(task.completedAt).tasksCompleted += 1;
  for (const item of capturedItems) dayForTimestamp(item.createdAt).inboxCaptured += 1;
  for (const video of videos) {
    const day = dayForTimestamp(video.createdAt);
    day.videos += 1;
    day.visualFrames += validArray(video.visualEvidence).length;
  }
  for (const card of knowledgeCards) dayForTimestamp(card.createdAt).knowledgeCards += 1;
  for (const inquiry of inquiries) dayForTimestamp(inquiry.createdAt).inquiries += 1;
  for (const topic of learningTopics) dayForTimestamp(topic.updatedAt).learningTopics += 1;
  for (const idea of creatorIdeas) dayForTimestamp(idea.createdAt).creatorIdeas += 1;
  for (const review of creatorReviews) dayForTimestamp(review.createdAt).creatorReviews += 1;
  for (const card of studyCards) dayForTimestamp(card.createdAt).studyCardsCreated += 1;
  for (const attempt of studyAttempts) dayForTimestamp(attempt.reviewedAt).studyReviews += 1;
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
      + day.videos + day.visualFrames + day.knowledgeCards + day.inquiries + day.learningTopics + day.creatorIdeas + day.creatorReviews
      + day.studyCardsCreated + day.studyReviews;
  }
  const sourceStats = {
    completedTasks: completedTasks.length,
    createdTasks: tasksCreated.length,
    capturedItems: capturedItems.length,
    plannedItems: capturedItems.filter((item) => item.status === "planned").length,
    habitCheckins,
    videos: videos.length,
    visualFrames: videos.reduce((total, video) => total + validArray(video.visualEvidence).length, 0),
    knowledgeCards: knowledgeCards.length,
    knowledgeInquiries: inquiries.length,
    learningTopics: learningTopics.length,
    creatorIdeas: creatorIdeas.length,
    creatorReviews: creatorReviews.length,
    studyCardsCreated: studyCards.length,
    studyReviews: studyAttempts.length,
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
    videos: videos.slice(-8).map(({ id, title, platform, createdAt, visualEvidence }) => ({
      id,
      title,
      platform,
      createdAt,
      visualFrameCount: validArray(visualEvidence).length,
    })),
    knowledgeCards: knowledgeCards.slice(-12).map(({ id, title, tags, sourceTitle, createdAt }) => ({ id, title, tags, sourceTitle, createdAt })),
    inquiries: inquiries.slice(-8).map(({ id, question, answerable, sources, createdAt }) => ({
      id,
      question,
      answerable,
      sourceCount: validArray(sources).length,
      createdAt,
    })),
    learningTopics: learningTopics.slice(-8).map(({ id, title, goal, map, updatedAt }) => ({ id, title, goal, nodeCount: map?.nodes.length || 0, updatedAt })),
    creatorIdeas: creatorIdeas.slice(-8).map(({ id, title, platform, status, createdAt }) => ({ id, title, platform, status, createdAt })),
    creatorReviews: creatorReviews.slice(-8).map(({ id, title, platform, publishedAt, createdAt }) => ({ id, title, platform, publishedAt, createdAt })),
    studyCards: studyCards.slice(-12).map(({ id, kind, prompt, createdAt }) => ({ id, kind, prompt, createdAt })),
    studyAttempts: studyAttempts.slice(-16).map(({ id, cardId, cardPrompt, rating, correct, reviewedAt }) => ({ id, cardId, cardPrompt, rating, correct, reviewedAt })),
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
    version: 11,
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
    version: 11,
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
  return { ...next, version: 11, routes, activity };
}

export function completeRoutePhase(state, routeId, phaseId) {
  const route = validArray(state.routes).find((item) => item.id === routeId && !item.archivedAt);
  const currentPhase = route?.phases.find((phase) => !phase.completedAt);
  if (!route || !currentPhase || currentPhase.id !== phaseId || !currentPhase.actions.some((action) => action.linkedTaskId || action.linkedHabitId)) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 11,
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
    version: 11,
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
    version: 11,
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
    version: 11,
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
    version: 11,
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
    version: 11,
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
    version: 11,
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
    version: 11,
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

export function saveCreatorProfile(state, input) {
  const creator = sanitizeCreatorStudio(state.creator);
  const profile = sanitizeCreatorProfile({ ...creator.profile, ...(input || {}), updatedAt: new Date().toISOString() });
  if (!profile.niche && !profile.audience && !profile.voice && !profile.platforms.length) return state;
  return {
    ...state,
    version: 11,
    creator: { ...creator, profile },
    activity: [...state.activity, {
      id: createId("activity"),
      label: "更新创作定位",
      detail: [profile.niche, profile.audience].filter(Boolean).join(" · "),
      createdAt: profile.updatedAt,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function addCreatorSignal(state, input) {
  const creator = sanitizeCreatorStudio(state.creator);
  if (creator.signals.length >= MAX_CREATOR_SIGNALS) return state;
  const signal = sanitizeCreatorSignal({ ...input, id: createId("creator-signal"), createdAt: new Date().toISOString() });
  if (!signal.title || !signal.note) return state;
  return {
    ...state,
    version: 11,
    creator: { ...creator, signals: [...creator.signals, signal].slice(-MAX_CREATOR_SIGNALS) },
    activity: [...state.activity, {
      id: createId("activity"),
      label: "记录一个创作信号",
      detail: `${signal.platform || "来源待定"} · ${signal.title}`,
      createdAt: signal.createdAt,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function removeCreatorSignal(state, signalId) {
  const creator = sanitizeCreatorStudio(state.creator);
  const signal = creator.signals.find((item) => item.id === signalId);
  if (!signal) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 11,
    creator: { ...creator, signals: creator.signals.filter((item) => item.id !== signalId) },
    activity: [...state.activity, {
      id: createId("activity"),
      label: "移除一个创作信号",
      detail: signal.title,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

function creatorSourceIndex(state) {
  const creator = sanitizeCreatorStudio(state.creator);
  const index = new Map();
  for (const video of validArray(state.videos)) {
    index.set(`video:${video.id}`, sanitizeCreatorSourceRef({
      kind: "video",
      id: video.id,
      title: video.title,
      url: video.url,
      evidence: [video.summary?.oneSentence, video.summary?.creatorInsights?.hook, video.summary?.creatorInsights?.structure].filter(Boolean).join("；"),
    }));
  }
  for (const card of validArray(state.knowledge)) {
    index.set(`knowledge:${card.id}`, sanitizeCreatorSourceRef({
      kind: "knowledge",
      id: card.id,
      title: card.title,
      url: card.sourceUrl,
      evidence: card.content,
    }));
  }
  for (const signal of creator.signals) {
    index.set(`signal:${signal.id}`, sanitizeCreatorSourceRef({
      kind: "signal",
      id: signal.id,
      title: signal.title,
      url: signal.url,
      evidence: signal.note,
    }));
  }
  return index;
}

export function saveCreatorIdea(state, input) {
  const creator = sanitizeCreatorStudio(state.creator);
  const existing = creator.ideas.find((idea) => idea.id === input?.id);
  if (!existing && creator.ideas.length >= MAX_CREATOR_IDEAS) return state;
  const sourceIndex = creatorSourceIndex(state);
  const sourceRefs = validArray(input?.sourceRefs).map((source) => sourceIndex.get(`${source?.kind}:${source?.id}`)).filter(Boolean);
  const now = new Date().toISOString();
  const idea = sanitizeCreatorIdea({
    ...input,
    id: existing?.id || input?.id,
    sourceRefs,
    linkedTaskId: existing?.linkedTaskId || input?.linkedTaskId || null,
    linkedBoardId: existing?.linkedBoardId || input?.linkedBoardId || null,
    linkedBoardRecordId: existing?.linkedBoardRecordId || input?.linkedBoardRecordId || null,
    createdAt: existing?.createdAt || input?.createdAt || now,
    updatedAt: now,
  });
  if (!idea.title || !idea.promise || !idea.hook || !idea.angle || !idea.steps.length) return state;
  return {
    ...state,
    version: 11,
    creator: { ...creator, ideas: [...creator.ideas.filter((item) => item.id !== idea.id), idea].slice(-MAX_CREATOR_IDEAS) },
    activity: [...state.activity, {
      id: createId("activity"),
      label: existing ? "调整一个创作选题" : "保存一个创作选题",
      detail: `${idea.platform || "平台待定"} · ${idea.title} · ${idea.sourceRefs.length} 条来源`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function updateCreatorIdea(state, ideaId, input, recordActivity = true) {
  const creator = sanitizeCreatorStudio(state.creator);
  const idea = creator.ideas.find((item) => item.id === ideaId);
  if (!idea) return state;
  const statusOrder = ["idea", "drafting", "producing", "published"];
  const requestedStatus = statusOrder.includes(input?.status) ? input.status : idea.status;
  const status = statusOrder.indexOf(requestedStatus) >= statusOrder.indexOf(idea.status) ? requestedStatus : idea.status;
  const stepExists = input?.stepId && idea.steps.some((step) => step.id === input.stepId);
  const now = new Date().toISOString();
  const nextIdea = {
    ...idea,
    status,
    steps: stepExists ? idea.steps.map((step) => step.id === input.stepId ? { ...step, done: Boolean(input.stepDone) } : step) : idea.steps,
    updatedAt: now,
  };
  if (nextIdea.status === idea.status && nextIdea.steps.every((step, index) => step.done === idea.steps[index]?.done)) return state;
  return {
    ...state,
    version: 11,
    creator: { ...creator, ideas: creator.ideas.map((item) => item.id === idea.id ? nextIdea : item) },
    activity: recordActivity ? [...state.activity, {
      id: createId("activity"),
      label: status !== idea.status ? "推进一个创作选题" : "更新创作步骤",
      detail: idea.title,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY) : state.activity,
  };
}

export function createCreatorIdeaTask(state, ideaId, recordActivity = true) {
  const creator = sanitizeCreatorStudio(state.creator);
  const idea = creator.ideas.find((item) => item.id === ideaId);
  if (!idea) return state;
  if (idea.linkedTaskId && state.tasks.some((task) => task.id === idea.linkedTaskId)) return state;
  let next = addTask(state, {
    title: idea.title,
    note: [
      "来自创作工作室",
      idea.platform ? `平台：${idea.platform}` : "",
      `开头：${idea.hook}`,
      idea.sourceRefs.length ? `依据：${idea.sourceRefs.map((source) => source.title).join("、")}` : "原创命题，暂无外部来源",
    ].filter(Boolean).join(" · "),
    source: "agent",
  });
  const linkedTaskId = next.tasks.at(-1)?.id || null;
  if (!linkedTaskId) return state;
  const now = new Date().toISOString();
  const nextCreator = sanitizeCreatorStudio(next.creator);
  next = {
    ...next,
    version: 11,
    creator: {
      ...nextCreator,
      ideas: nextCreator.ideas.map((item) => item.id === idea.id ? {
        ...item,
        linkedTaskId,
        status: item.status === "idea" ? "drafting" : item.status,
        updatedAt: now,
      } : item),
    },
  };
  if (!recordActivity) return next;
  return {
    ...next,
    activity: [...next.activity, {
      id: createId("activity"),
      label: "从创作选题加入任务",
      detail: idea.title,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function addCreatorIdeaToBoard(state, ideaId, boardId) {
  const creator = sanitizeCreatorStudio(state.creator);
  const idea = creator.ideas.find((item) => item.id === ideaId);
  const board = validArray(state.boards).find((item) => item.id === boardId && !item.archivedAt);
  if (!idea || !board) return state;
  if (idea.linkedBoardId && idea.linkedBoardRecordId) {
    const linkedBoard = state.boards.find((item) => item.id === idea.linkedBoardId);
    if (linkedBoard?.records.some((record) => record.id === idea.linkedBoardRecordId)) return state;
  }
  const formatLabels = { video: "视频", graphic: "图文", article: "文章", live: "直播" };
  const values = Object.fromEntries(board.fields.map((field) => {
    const name = field.name.toLocaleLowerCase("zh-CN");
    let value = field.type === "checkbox" ? false : field.type === "number" ? 0 : "";
    if (name.includes("平台")) value = field.type === "select" ? (field.options.includes(idea.platform) ? idea.platform : "") : idea.platform;
    if (name.includes("形式") || name.includes("类型")) {
      const format = formatLabels[idea.format];
      value = field.type === "select" ? (field.options.includes(format) ? format : "") : format;
    }
    if (name.includes("来源") && field.type === "text") value = idea.sourceRefs.map((source) => source.title).join("、");
    return [field.id, value];
  }));
  const beforeIds = new Set(board.records.map((record) => record.id));
  let next = addBoardRecord(state, board.id, { title: idea.title, statusId: board.statuses[0]?.id, values }, false);
  const updatedBoard = next.boards.find((item) => item.id === board.id);
  const record = updatedBoard?.records.find((item) => !beforeIds.has(item.id));
  if (!record) return state;
  const now = new Date().toISOString();
  const nextCreator = sanitizeCreatorStudio(next.creator);
  return {
    ...next,
    version: 11,
    creator: {
      ...nextCreator,
      ideas: nextCreator.ideas.map((item) => item.id === idea.id ? { ...item, linkedBoardId: board.id, linkedBoardRecordId: record.id, updatedAt: now } : item),
    },
    activity: [...next.activity, {
      id: createId("activity"),
      label: "把创作选题接入业务台",
      detail: `${board.name} · ${idea.title}`,
      createdAt: now,
      source: "agent",
    }].slice(-MAX_ACTIVITY),
  };
}

export function removeCreatorIdea(state, ideaId) {
  const creator = sanitizeCreatorStudio(state.creator);
  const idea = creator.ideas.find((item) => item.id === ideaId);
  if (!idea) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 11,
    creator: {
      ...creator,
      ideas: creator.ideas.filter((item) => item.id !== ideaId),
      reviews: creator.reviews.map((review) => review.ideaId === ideaId ? { ...review, ideaId: null } : review),
    },
    activity: [...state.activity, {
      id: createId("activity"),
      label: "移除一个创作选题",
      detail: idea.title,
      createdAt: now,
      source: "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function saveCreatorReview(state, input) {
  const creator = sanitizeCreatorStudio(state.creator);
  const existing = creator.reviews.find((review) => review.id === input?.id);
  if (!existing && creator.reviews.length >= MAX_CREATOR_REVIEWS) return state;
  const ideaId = input?.ideaId && creator.ideas.some((idea) => idea.id === input.ideaId) ? input.ideaId : null;
  const now = new Date().toISOString();
  const review = sanitizeCreatorReview({
    ...input,
    id: existing?.id || input?.id,
    ideaId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  const hasEvidence = Object.values(review.metrics).some((metric) => metric > 0) || Boolean(review.notes);
  if (!review.title || !review.platform || !review.publishedAt || !hasEvidence) return state;
  return {
    ...state,
    version: 11,
    creator: {
      ...creator,
      ideas: creator.ideas.map((idea) => idea.id === ideaId ? { ...idea, status: "published", updatedAt: now } : idea),
      reviews: [...creator.reviews.filter((item) => item.id !== review.id), review].slice(-MAX_CREATOR_REVIEWS),
    },
    activity: [...state.activity, {
      id: createId("activity"),
      label: review.analysis ? "保存一次内容复盘" : "记录一条发布结果",
      detail: `${review.platform} · ${review.title}`,
      createdAt: now,
      source: review.analysis ? "agent" : "human",
    }].slice(-MAX_ACTIVITY),
  };
}

export function removeCreatorReview(state, reviewId) {
  const creator = sanitizeCreatorStudio(state.creator);
  const review = creator.reviews.find((item) => item.id === reviewId);
  if (!review) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    version: 11,
    creator: { ...creator, reviews: creator.reviews.filter((item) => item.id !== reviewId) },
    activity: [...state.activity, {
      id: createId("activity"),
      label: "移除一次内容复盘",
      detail: review.title,
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

function evidenceGraphNodeId(kind, entityId, parentId = "") {
  return `${kind}:${parentId ? `${parentId}:` : ""}${entityId}`;
}

export function buildEvidenceGraph(state) {
  const value = state && typeof state === "object" ? state : {};
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const addNode = (node) => {
    if (!node.id || nodeIds.has(node.id) || !node.title) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (from, to, kind, label) => {
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return;
    const id = `${kind}:${from}->${to}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, from, to, kind, label: cleanText(label, 120) });
  };
  const videos = validArray(value.videos).slice(-MAX_VIDEOS).filter((video) => cleanText(video?.id, 100));
  const knowledge = validArray(value.knowledge).slice(-MAX_KNOWLEDGE_CARDS).filter((card) => cleanText(card?.id, 100));
  const topics = validArray(value.learningTopics).slice(-MAX_LEARNING_TOPICS).filter((topic) => cleanText(topic?.id, 100));
  const studyCards = validArray(value.study?.cards).slice(-MAX_STUDY_CARDS).filter((card) => cleanText(card?.id, 100));
  const videoByUrl = new Map();
  const frameNodeByVideoAndId = new Map();

  for (const video of videos) {
    const videoId = cleanText(video.id, 100);
    const nodeId = evidenceGraphNodeId("video", videoId);
    const videoUrl = cleanText(video.url, 2_000);
    addNode({
      id: nodeId,
      entityId: videoId,
      parentId: null,
      kind: "video",
      title: cleanText(video.title, 120),
      detail: cleanText(video.summary?.oneSentence, 600) || cleanText(video.description, 600) || "已保存的视频资料",
      meta: `${cleanText(video.platform, 30) || "video"} · ${validArray(video.visualEvidence).length} 帧`,
      createdAt: validIso(video.createdAt),
    });
    if (videoUrl && !videoByUrl.has(videoUrl)) videoByUrl.set(videoUrl, video);
    for (const frame of validArray(video.visualEvidence).slice(0, 8)) {
      const frameId = cleanText(frame?.id, 100);
      if (!frameId) continue;
      const frameNodeId = evidenceGraphNodeId("frame", frameId, videoId);
      const frameDetail = cleanText(frame.observation, 600) || cleanText(frame.modelText, 600) || cleanText(frame.ocrText, 600) || cleanText(frame.uncertainty, 600) || "本地抽取的画面证据";
      addNode({
        id: frameNodeId,
        entityId: frameId,
        parentId: videoId,
        kind: "frame",
        title: `${cleanText(frame.timestamp, 16) || "画面"} · ${frameDetail.slice(0, 42)}`,
        detail: frameDetail,
        meta: `画面证据 · ${cleanText(video.title, 80)}`,
        createdAt: validIso(video.createdAt),
      });
      frameNodeByVideoAndId.set(`${videoId}:${frameId}`, frameNodeId);
      addEdge(nodeId, frameNodeId, "contains", "包含画面");
    }
  }

  for (const card of knowledge) {
    const cardId = cleanText(card.id, 100);
    addNode({
      id: evidenceGraphNodeId("knowledge", cardId),
      entityId: cardId,
      parentId: null,
      kind: "knowledge",
      title: cleanText(card.title, 120),
      detail: cleanText(card.content, 600),
      meta: validArray(card.tags).length ? validArray(card.tags).slice(0, 3).map((tag) => `#${cleanText(tag, 24)}`).join(" ") : cleanText(card.sourceTitle, 120) || "知识卡",
      createdAt: validIso(card.createdAt),
    });
  }

  for (const topic of topics) {
    const topicId = cleanText(topic.id, 100);
    addNode({
      id: evidenceGraphNodeId("topic", topicId),
      entityId: topicId,
      parentId: null,
      kind: "topic",
      title: cleanText(topic.title, 120),
      detail: cleanText(topic.map?.thesis, 600) || cleanText(topic.goal, 600),
      meta: `${validArray(topic.sources).length} 条资料 · ${validArray(topic.map?.nodes).length} 节点`,
      createdAt: validIso(topic.updatedAt, validIso(topic.createdAt)),
    });
  }

  for (const card of studyCards) {
    const studyId = cleanText(card.id, 100);
    const dueAt = validIso(card.dueAt);
    const due = dueAt && new Date(dueAt).getTime() <= Date.now();
    addNode({
      id: evidenceGraphNodeId("study", studyId),
      entityId: studyId,
      parentId: null,
      kind: "study",
      title: cleanText(card.prompt, 120),
      detail: cleanText(card.explanation, 600) || "由知识卡生成的主动回忆材料",
      meta: card.suspended ? "已暂停" : due ? "当前到期" : `${Number.isFinite(card.reviewCount) ? Math.max(0, Math.round(card.reviewCount)) : 0} 次复习`,
      createdAt: validIso(card.updatedAt, validIso(card.createdAt)),
    });
  }

  for (const card of knowledge) {
    const cardId = cleanText(card.id, 100);
    const cardNodeId = evidenceGraphNodeId("knowledge", cardId);
    const sourceVideo = videoByUrl.get(cleanText(card.sourceUrl, 2_000));
    if (!sourceVideo) continue;
    const videoId = cleanText(sourceVideo.id, 100);
    addEdge(evidenceGraphNodeId("video", videoId), cardNodeId, "distills", "提炼为知识");
    for (const frameId of [...new Set(validArray(card.evidenceFrameIds).map((id) => cleanText(id, 100)).filter(Boolean))]) {
      const frameNodeId = frameNodeByVideoAndId.get(`${videoId}:${frameId}`);
      if (frameNodeId) addEdge(frameNodeId, cardNodeId, "grounds", "画面支撑");
    }
  }

  for (const topic of topics) {
    const topicNodeId = evidenceGraphNodeId("topic", cleanText(topic.id, 100));
    for (const source of validArray(topic.sources)) {
      const kind = source?.kind === "video" ? "video" : source?.kind === "knowledge" ? "knowledge" : "";
      const sourceId = cleanText(source?.id, 100);
      if (kind && sourceId) addEdge(evidenceGraphNodeId(kind, sourceId), topicNodeId, "uses", "进入专题");
    }
  }

  for (const studyCard of studyCards) {
    const studyNodeId = evidenceGraphNodeId("study", cleanText(studyCard.id, 100));
    for (const source of validArray(studyCard.sources)) {
      const cardId = cleanText(source?.cardId, 100);
      if (cardId) addEdge(evidenceGraphNodeId("knowledge", cardId), studyNodeId, "reviews", "生成复习");
    }
  }

  for (const relation of findKnowledgeRelations(knowledge, 24)) {
    const shared = [...validArray(relation.sharedTags), ...validArray(relation.sharedTerms)].filter(Boolean).slice(0, 3).join(" · ");
    addEdge(
      evidenceGraphNodeId("knowledge", relation.leftId),
      evidenceGraphNodeId("knowledge", relation.rightId),
      "relates",
      shared ? `共享 ${shared}` : "跨来源关联",
    );
  }

  const explicitAdjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges.filter((edge) => edge.kind !== "relates")) {
    explicitAdjacency.get(edge.from)?.push(edge.to);
    explicitAdjacency.get(edge.to)?.push(edge.from);
  }
  const grounded = new Set(nodes.filter((node) => node.kind === "video" || node.kind === "frame").map((node) => node.id));
  const queue = [...grounded];
  while (queue.length) {
    const current = queue.shift();
    for (const next of explicitAdjacency.get(current) || []) {
      if (grounded.has(next)) continue;
      grounded.add(next);
      queue.push(next);
    }
  }
  return {
    nodes,
    edges,
    connectedNodeIds: nodes.filter((node) => grounded.has(node.id)).map((node) => node.id),
    orphanNodeIds: nodes.filter((node) => !grounded.has(node.id)).map((node) => node.id),
  };
}

export function findEvidencePath(graph, fromId, toId, maxDepth = 6) {
  const value = graph && typeof graph === "object" ? graph : {};
  const nodes = validArray(value.nodes);
  const edges = validArray(value.edges);
  const nodeIds = new Set(nodes.map((node) => cleanText(node?.id, 240)).filter(Boolean));
  const from = cleanText(fromId, 240);
  const to = cleanText(toId, 240);
  if (!nodeIds.has(from) || !nodeIds.has(to)) return null;
  if (from === to) return { nodeIds: [from], edgeIds: [] };
  const depthLimit = Math.max(1, Math.min(Number(maxDepth) || 6, 12));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!nodeIds.has(edge?.from) || !nodeIds.has(edge?.to) || !edge?.id) continue;
    adjacency.get(edge.from).push({ nodeId: edge.to, edgeId: edge.id });
    adjacency.get(edge.to).push({ nodeId: edge.from, edgeId: edge.id });
  }
  const queue = [{ nodeId: from, nodeIds: [from], edgeIds: [] }];
  const visited = new Set([from]);
  while (queue.length) {
    const current = queue.shift();
    if (current.edgeIds.length >= depthLimit) continue;
    for (const next of adjacency.get(current.nodeId) || []) {
      if (visited.has(next.nodeId)) continue;
      const path = {
        nodeId: next.nodeId,
        nodeIds: [...current.nodeIds, next.nodeId],
        edgeIds: [...current.edgeIds, next.edgeId],
      };
      if (next.nodeId === to) return { nodeIds: path.nodeIds, edgeIds: path.edgeIds };
      visited.add(next.nodeId);
      queue.push(path);
    }
  }
  return null;
}
