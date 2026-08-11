export const WORKBENCH_STORAGE_KEY: "evolve-desk.workspace.v1";

export type WorkTask = {
  id: string;
  title: string;
  note: string;
  priority: "low" | "normal" | "high";
  done: boolean;
  source: "manual" | "agent" | "inbox";
  createdAt: string;
  completedAt: string | null;
};

export type InboxItem = {
  id: string;
  content: string;
  kind: "note" | "link";
  status: "new" | "planned";
  createdAt: string;
};

export type Habit = { id: string; name: string; completedDates: string[] };
export type Activity = {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
  source: "human" | "agent";
};

export type VideoSummary = {
  oneSentence: string;
  audience: string;
  worthWatching: string;
  informationDensity: "low" | "medium" | "high";
  keyPoints: Array<{ title: string; detail: string; timestamp: string | null }>;
  chapters: Array<{ title: string; summary: string; timestamp: string | null }>;
  concepts: Array<{ term: string; explanation: string }>;
  caveats: string[];
  visualFindings: Array<{ frameId: string; timestamp: string; observation: string }>;
  creatorInsights: { hook: string; structure: string; angles: string[] };
  suggestedTasks: Array<{ title: string; note: string }>;
  cards: Array<{ title: string; content: string; tags: string[]; evidenceFrameIds: string[] }>;
};

export type VisualEvidenceFrame = {
  id: string;
  seconds: number;
  timestamp: string;
  ocrText: string;
  modelText: string;
  observation: string;
  uncertainty: string;
};

export type VideoRecord = {
  id: string;
  url: string;
  platform: "youtube" | "bilibili" | "xiaohongshu" | "douyin" | "local";
  sourceId: string;
  title: string;
  author: string;
  description: string;
  duration: number | null;
  thumbnail: string;
  hasVideo: boolean;
  width: number;
  height: number;
  localFileName: string;
  transcriptSource: "platform" | "local-whisper" | "manual";
  visualEvidence: VisualEvidenceFrame[];
  summary: VideoSummary;
  createdAt: string;
};

export type KnowledgeCard = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  sourceUrl: string;
  sourceTitle: string;
  evidenceFrameIds: string[];
  createdAt: string;
};

export type KnowledgeInquiry = {
  id: string;
  question: string;
  answerable: boolean;
  answer: string;
  keyPoints: string[];
  gaps: string[];
  sources: Array<{ cardId: string; cardTitle: string; sourceTitle: string; sourceUrl: string }>;
  suggestedTask: { title: string; note: string } | null;
  createdAt: string;
};

export type StudySourceRef = {
  cardId: string;
  cardTitle: string;
  sourceTitle: string;
  sourceUrl: string;
};

export type StudyCardKind = "recall" | "multiple_choice";
export type StudyRating = "again" | "hard" | "good" | "easy";

export type StudyCard = {
  id: string;
  kind: StudyCardKind;
  prompt: string;
  answer: string;
  explanation: string;
  options: string[];
  tags: string[];
  sources: StudySourceRef[];
  dueAt: string;
  intervalDays: number;
  easeFactor: number;
  reviewCount: number;
  lapseCount: number;
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt: string | null;
};

export type StudyCardDraft = Pick<StudyCard, "kind" | "prompt" | "answer" | "explanation" | "options" | "tags" | "sources"> & {
  id?: string;
};

export type StudyAttempt = {
  id: string;
  cardId: string;
  cardPrompt: string;
  rating: StudyRating;
  selectedAnswer: string;
  correct: boolean | null;
  previousIntervalDays: number;
  nextIntervalDays: number;
  reviewedAt: string;
  nextDueAt: string;
};

export type StudyState = {
  cards: StudyCard[];
  attempts: StudyAttempt[];
};

export type WeeklyReviewSourceStats = {
  completedTasks: number;
  createdTasks: number;
  capturedItems: number;
  plannedItems: number;
  habitCheckins: number;
  videos: number;
  visualFrames: number;
  knowledgeCards: number;
  knowledgeInquiries: number;
  learningTopics: number;
  creatorIdeas: number;
  creatorReviews: number;
  studyCardsCreated: number;
  studyReviews: number;
};

export type WeeklyReview = {
  id: string;
  weekKey: string;
  periodLabel: string;
  headline: string;
  summary: string;
  wins: string[];
  friction: string[];
  knowledgeConnections: string[];
  nextWeekFocus: string;
  suggestedActions: Array<{ title: string; note: string }>;
  sourceStats: WeeklyReviewSourceStats;
  createdAt: string;
};

export type WeeklyDaySnapshot = {
  key: string;
  label: string;
  dateLabel: string;
  tasksCreated: number;
  tasksCompleted: number;
  inboxCaptured: number;
  habitCheckins: number;
  videos: number;
  visualFrames: number;
  knowledgeCards: number;
  inquiries: number;
  learningTopics: number;
  creatorIdeas: number;
  creatorReviews: number;
  studyCardsCreated: number;
  studyReviews: number;
  activityCount: number;
  total: number;
};

export type WeeklySnapshot = {
  weekKey: string;
  startDate: string;
  endDate: string;
  periodLabel: string;
  days: WeeklyDaySnapshot[];
  completedTasks: Array<Pick<WorkTask, "id" | "title" | "note" | "completedAt">>;
  createdTasks: Array<Pick<WorkTask, "id" | "title" | "note" | "done" | "createdAt">>;
  openTasks: Array<Pick<WorkTask, "id" | "title" | "note" | "priority" | "createdAt">>;
  capturedItems: Array<Pick<InboxItem, "id" | "content" | "kind" | "status" | "createdAt">>;
  videos: Array<Pick<VideoRecord, "id" | "title" | "platform" | "createdAt"> & { visualFrameCount: number }>;
  knowledgeCards: Array<Pick<KnowledgeCard, "id" | "title" | "tags" | "sourceTitle" | "createdAt">>;
  inquiries: Array<{ id: string; question: string; answerable: boolean; sourceCount: number; createdAt: string }>;
  learningTopics: Array<Pick<LearningTopic, "id" | "title" | "goal" | "updatedAt"> & { nodeCount: number }>;
  creatorIdeas: Array<Pick<CreatorIdea, "id" | "title" | "platform" | "status" | "createdAt">>;
  creatorReviews: Array<Pick<CreatorReview, "id" | "title" | "platform" | "publishedAt" | "createdAt">>;
  studyCards: Array<Pick<StudyCard, "id" | "kind" | "prompt" | "createdAt">>;
  studyAttempts: Array<Pick<StudyAttempt, "id" | "cardId" | "cardPrompt" | "rating" | "correct" | "reviewedAt">>;
  activity: Array<Pick<Activity, "label" | "detail" | "source" | "createdAt">>;
  sourceStats: WeeklyReviewSourceStats;
  hasEvidence: boolean;
};

export type KnowledgeRelation = {
  id: string;
  leftId: string;
  rightId: string;
  leftTitle: string;
  rightTitle: string;
  leftSourceTitle: string;
  rightSourceTitle: string;
  sharedTags: string[];
  sharedTerms: string[];
  score: number;
};

export type LearningSourceRef = {
  kind: "video" | "knowledge";
  id: string;
};

export type LearningMapNode = {
  id: string;
  kind: "idea" | "method" | "evidence" | "contrast";
  title: string;
  summary: string;
  sourceRefs: LearningSourceRef[];
};

export type LearningMapEdge = {
  from: string;
  to: string;
  relation: "supports" | "extends" | "contrasts" | "depends_on";
  label: string;
};

export type LearningMap = {
  thesis: string;
  nodes: LearningMapNode[];
  edges: LearningMapEdge[];
  openQuestions: Array<{ id: string; question: string; reason: string }>;
};

export type LearningTopic = {
  id: string;
  title: string;
  goal: string;
  sources: LearningSourceRef[];
  map: LearningMap | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonalRouteAction = {
  id: string;
  title: string;
  note: string;
  mode: "task" | "habit";
  linkedTaskId: string | null;
  linkedHabitId: string | null;
};

export type PersonalRoutePhase = {
  id: string;
  title: string;
  outcome: string;
  completionRule: string;
  actions: PersonalRouteAction[];
  completedAt: string | null;
};

export type PersonalRoute = {
  id: string;
  name: string;
  purpose: string;
  category: "create" | "learn" | "practice" | "manage";
  accent: "blue" | "coral" | "violet" | "green" | "amber";
  cadence: string;
  successMetric: string;
  reflection: string;
  phases: PersonalRoutePhase[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type PersonalRouteBlueprint = Omit<PersonalRoute, "id" | "createdAt" | "updatedAt" | "archivedAt" | "phases"> & {
  id?: string;
  createdAt?: string;
  phases: Array<Omit<PersonalRoutePhase, "id" | "completedAt" | "actions"> & {
    id?: string;
    completedAt?: string | null;
    actions: Array<Omit<PersonalRouteAction, "id" | "linkedTaskId" | "linkedHabitId"> & {
      id?: string;
      linkedTaskId?: string | null;
      linkedHabitId?: string | null;
    }>;
  }>;
};

export type PersonalBoardStatus = {
  id: string;
  label: string;
  tone: "blue" | "coral" | "violet" | "green" | "amber" | "slate";
  done: boolean;
};

export type PersonalBoardField = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  required: boolean;
  options: string[];
};

export type PersonalBoardValue = string | number | boolean;

export type PersonalBoardRecord = {
  id: string;
  title: string;
  statusId: string;
  values: Record<string, PersonalBoardValue>;
  linkedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonalBoard = {
  id: string;
  name: string;
  purpose: string;
  itemLabel: string;
  accent: "blue" | "coral" | "violet" | "green" | "amber";
  defaultView: "board" | "table";
  reflection: string;
  linkedRouteId: string | null;
  statuses: PersonalBoardStatus[];
  fields: PersonalBoardField[];
  records: PersonalBoardRecord[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type PersonalBoardBlueprint = Omit<PersonalBoard, "id" | "createdAt" | "updatedAt" | "archivedAt" | "records" | "statuses" | "fields"> & {
  id?: string;
  createdAt?: string;
  statuses: Array<Omit<PersonalBoardStatus, "id"> & { id?: string }>;
  fields: Array<Omit<PersonalBoardField, "id"> & { id?: string }>;
};

export type CreatorProfile = {
  niche: string;
  audience: string;
  voice: string;
  platforms: string[];
  updatedAt: string;
};

export type CreatorSignal = {
  id: string;
  title: string;
  url: string;
  note: string;
  platform: string;
  observedAt: string;
  createdAt: string;
};

export type CreatorSourceRef = {
  kind: "video" | "knowledge" | "signal";
  id: string;
  title: string;
  url: string;
  evidence: string;
};

export type CreatorIdeaStep = {
  id: string;
  title: string;
  note: string;
  done: boolean;
};

export type CreatorIdea = {
  id: string;
  title: string;
  promise: string;
  hook: string;
  angle: string;
  format: "video" | "graphic" | "article" | "live";
  platform: string;
  sourceRefs: CreatorSourceRef[];
  originalityGuard: string;
  reflection: string;
  steps: CreatorIdeaStep[];
  status: "idea" | "drafting" | "producing" | "published";
  linkedTaskId: string | null;
  linkedBoardId: string | null;
  linkedBoardRecordId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatorIdeaDraft = Omit<CreatorIdea, "id" | "createdAt" | "updatedAt" | "steps" | "status" | "linkedTaskId" | "linkedBoardId" | "linkedBoardRecordId"> & {
  steps: Array<Omit<CreatorIdeaStep, "id" | "done"> & { id?: string; done?: boolean }>;
  status?: CreatorIdea["status"];
};

export type CreatorMetrics = {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  follows: number;
};

export type CreatorReviewAnalysis = {
  headline: string;
  observations: Array<{ claim: string; metricKeys: Array<keyof CreatorMetrics> }>;
  hypotheses: Array<{ idea: string; confidence: "low" | "medium" }>;
  gaps: string[];
  nextExperiment: { change: string; reason: string; successSignal: string };
  reflection: string;
};

export type CreatorReview = {
  id: string;
  ideaId: string | null;
  title: string;
  platform: string;
  url: string;
  publishedAt: string;
  metrics: CreatorMetrics;
  notes: string;
  analysis: CreatorReviewAnalysis | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatorStudioState = {
  profile: CreatorProfile;
  signals: CreatorSignal[];
  ideas: CreatorIdea[];
  reviews: CreatorReview[];
};

export type WorkbenchState = {
  version: 11;
  focusTaskId: string | null;
  tasks: WorkTask[];
  inbox: InboxItem[];
  habits: Habit[];
  activity: Activity[];
  videos: VideoRecord[];
  knowledge: KnowledgeCard[];
  knowledgeInquiries: KnowledgeInquiry[];
  learningTopics: LearningTopic[];
  weeklyReviews: WeeklyReview[];
  routes: PersonalRoute[];
  boards: PersonalBoard[];
  creator: CreatorStudioState;
  study: StudyState;
};

export type AgentAction =
  | { type: "add_task"; title: string; note?: string; priority?: "low" | "normal" | "high" }
  | { type: "save_inbox"; content: string }
  | { type: "add_habit"; name: string }
  | { type: "set_focus"; title: string; note?: string }
  | { type: "activate_route_action"; routeId: string; phaseId: string; actionId: string }
  | { type: "add_board_record"; boardId: string; statusId: string; title: string }
  | { type: "advance_board_record"; boardId: string; recordId: string; statusId: string }
  | { type: "create_board_task"; boardId: string; recordId: string }
  | { type: "advance_creator_idea"; ideaId: string; status: CreatorIdea["status"] }
  | { type: "create_creator_task"; ideaId: string }
  | { type: "create_study_task"; cardIds: string[] };

export function getTodayKey(date?: Date): string;
export function getWeekKey(date?: Date): string;
export function inboxKind(content: string): "note" | "link";
export function createInitialWorkbench(): WorkbenchState;
export function parseWorkbenchState(raw: string | null): WorkbenchState;
export function addTask(
  state: WorkbenchState,
  input: { title: string; note?: string; priority?: "low" | "normal" | "high"; source?: WorkTask["source"] },
): WorkbenchState;
export function addInboxItem(state: WorkbenchState, content: string, source?: Activity["source"]): WorkbenchState;
export function applyAgentActions(state: WorkbenchState, actions: AgentAction[], planTitle?: string): WorkbenchState;
export function saveVideoSummary(
  state: WorkbenchState,
  input: Omit<VideoRecord, "id" | "createdAt"> & { capturedUrl?: string },
  createTasks?: boolean,
): WorkbenchState;
export function saveKnowledgeInquiry(
  state: WorkbenchState,
  input: Omit<KnowledgeInquiry, "id" | "createdAt">,
): WorkbenchState;
export function saveLearningTopic(
  state: WorkbenchState,
  input: Omit<LearningTopic, "id" | "createdAt" | "updatedAt"> & { id?: string; map?: LearningMap | null },
  actor?: "human" | "agent",
): WorkbenchState;
export function removeLearningTopic(state: WorkbenchState, topicId: string): WorkbenchState;
export function saveStudyCards(state: WorkbenchState, cards: StudyCardDraft[], actor?: "agent" | "human"): WorkbenchState;
export function rateStudyCard(
  state: WorkbenchState,
  cardId: string,
  rating: StudyRating,
  selectedAnswer?: string,
  reviewedAt?: Date,
): WorkbenchState;
export function removeStudyCard(state: WorkbenchState, cardId: string): WorkbenchState;
export function toggleStudyCardSuspended(state: WorkbenchState, cardId: string): WorkbenchState;
export function createStudyReviewTask(state: WorkbenchState, cardIds: string[], recordActivity?: boolean, now?: Date): WorkbenchState;
export function getDueStudyCards(state: WorkbenchState, now?: Date): StudyCard[];
export function buildWeeklySnapshot(state: WorkbenchState, anchorDate?: Date): WeeklySnapshot;
export function saveWeeklyReview(
  state: WorkbenchState,
  input: Omit<WeeklyReview, "id" | "createdAt">,
): WorkbenchState;
export function savePersonalRoute(state: WorkbenchState, input: PersonalRouteBlueprint | PersonalRoute): WorkbenchState;
export function activateRouteAction(
  state: WorkbenchState,
  routeId: string,
  phaseId: string,
  actionId: string,
  recordActivity?: boolean,
): WorkbenchState;
export function completeRoutePhase(state: WorkbenchState, routeId: string, phaseId: string): WorkbenchState;
export function archivePersonalRoute(state: WorkbenchState, routeId: string): WorkbenchState;
export function savePersonalBoard(state: WorkbenchState, input: PersonalBoardBlueprint | PersonalBoard): WorkbenchState;
export function addBoardRecord(
  state: WorkbenchState,
  boardId: string,
  input: { title: string; statusId?: string; values?: Record<string, PersonalBoardValue> },
  recordActivity?: boolean,
): WorkbenchState;
export function updateBoardRecord(
  state: WorkbenchState,
  boardId: string,
  recordId: string,
  input: { title?: string; statusId?: string; values?: Record<string, PersonalBoardValue> },
  recordActivity?: boolean,
): WorkbenchState;
export function removeBoardRecord(state: WorkbenchState, boardId: string, recordId: string): WorkbenchState;
export function createBoardRecordTask(state: WorkbenchState, boardId: string, recordId: string, recordActivity?: boolean): WorkbenchState;
export function archivePersonalBoard(state: WorkbenchState, boardId: string): WorkbenchState;
export function saveCreatorProfile(state: WorkbenchState, input: Partial<CreatorProfile>): WorkbenchState;
export function addCreatorSignal(
  state: WorkbenchState,
  input: Omit<CreatorSignal, "id" | "createdAt">,
): WorkbenchState;
export function removeCreatorSignal(state: WorkbenchState, signalId: string): WorkbenchState;
export function saveCreatorIdea(state: WorkbenchState, input: CreatorIdeaDraft | CreatorIdea): WorkbenchState;
export function updateCreatorIdea(
  state: WorkbenchState,
  ideaId: string,
  input: { status?: CreatorIdea["status"]; stepId?: string; stepDone?: boolean },
  recordActivity?: boolean,
): WorkbenchState;
export function createCreatorIdeaTask(state: WorkbenchState, ideaId: string, recordActivity?: boolean): WorkbenchState;
export function addCreatorIdeaToBoard(state: WorkbenchState, ideaId: string, boardId: string): WorkbenchState;
export function removeCreatorIdea(state: WorkbenchState, ideaId: string): WorkbenchState;
export function saveCreatorReview(
  state: WorkbenchState,
  input: Omit<CreatorReview, "id" | "createdAt" | "updatedAt"> & { id?: string },
): WorkbenchState;
export function removeCreatorReview(state: WorkbenchState, reviewId: string): WorkbenchState;
export function findKnowledgeRelations(cards: KnowledgeCard[], limit?: number): KnowledgeRelation[];
