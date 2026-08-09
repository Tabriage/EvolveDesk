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
  creatorInsights: { hook: string; structure: string; angles: string[] };
  suggestedTasks: Array<{ title: string; note: string }>;
  cards: Array<{ title: string; content: string; tags: string[] }>;
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
  localFileName: string;
  transcriptSource: "platform" | "local-whisper" | "manual";
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

export type WeeklyReviewSourceStats = {
  completedTasks: number;
  createdTasks: number;
  capturedItems: number;
  plannedItems: number;
  habitCheckins: number;
  videos: number;
  knowledgeCards: number;
  knowledgeInquiries: number;
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
  knowledgeCards: number;
  inquiries: number;
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
  videos: Array<Pick<VideoRecord, "id" | "title" | "platform" | "createdAt">>;
  knowledgeCards: Array<Pick<KnowledgeCard, "id" | "title" | "tags" | "sourceTitle" | "createdAt">>;
  inquiries: Array<{ id: string; question: string; answerable: boolean; sourceCount: number; createdAt: string }>;
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

export type WorkbenchState = {
  version: 7;
  focusTaskId: string | null;
  tasks: WorkTask[];
  inbox: InboxItem[];
  habits: Habit[];
  activity: Activity[];
  videos: VideoRecord[];
  knowledge: KnowledgeCard[];
  knowledgeInquiries: KnowledgeInquiry[];
  weeklyReviews: WeeklyReview[];
  routes: PersonalRoute[];
  boards: PersonalBoard[];
};

export type AgentAction =
  | { type: "add_task"; title: string; note?: string; priority?: "low" | "normal" | "high" }
  | { type: "save_inbox"; content: string }
  | { type: "add_habit"; name: string }
  | { type: "set_focus"; title: string; note?: string }
  | { type: "activate_route_action"; routeId: string; phaseId: string; actionId: string }
  | { type: "add_board_record"; boardId: string; statusId: string; title: string }
  | { type: "advance_board_record"; boardId: string; recordId: string; statusId: string }
  | { type: "create_board_task"; boardId: string; recordId: string };

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
export function findKnowledgeRelations(cards: KnowledgeCard[], limit?: number): KnowledgeRelation[];
