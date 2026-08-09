import assert from "node:assert/strict";
import test from "node:test";
import {
  activateRouteAction,
  addBoardRecord,
  addCreatorIdeaToBoard,
  addCreatorSignal,
  addInboxItem,
  addTask,
  applyAgentActions,
  archivePersonalBoard,
  archivePersonalRoute,
  buildWeeklySnapshot,
  completeRoutePhase,
  createBoardRecordTask,
  createCreatorIdeaTask,
  createInitialWorkbench,
  findKnowledgeRelations,
  getTodayKey,
  inboxKind,
  parseWorkbenchState,
  removeBoardRecord,
  removeCreatorIdea,
  removeCreatorReview,
  removeCreatorSignal,
  saveCreatorIdea,
  saveCreatorProfile,
  saveCreatorReview,
  saveKnowledgeInquiry,
  savePersonalBoard,
  savePersonalRoute,
  saveWeeklyReview,
  saveVideoSummary,
  updateBoardRecord,
  updateCreatorIdea,
} from "../app/features/workbench-core.mjs";

test("workbench state safely recovers and classifies captured links", () => {
  assert.deepEqual(parseWorkbenchState("not json"), createInitialWorkbench());
  assert.equal(inboxKind("https://example.com/video"), "link");
  assert.equal(inboxKind("记住这个想法"), "note");

  const original = createInitialWorkbench();
  const next = addInboxItem(original, "https://example.com/video");
  assert.equal(original.inbox.length, 0);
  assert.equal(next.inbox.length, 1);
  assert.equal(next.inbox[0].kind, "link");
  assert.equal(next.activity.length, 1);
});

test("tasks and confirmed agent actions form a real local workflow", () => {
  const initial = addTask(createInitialWorkbench(), { title: "完成首页", source: "manual" });
  assert.equal(initial.tasks.length, 1);
  assert.equal(initial.focusTaskId, initial.tasks[0].id);

  const planned = applyAgentActions(initial, [
    { type: "add_task", title: "检查手机布局", priority: "high" },
    { type: "add_habit", name: "每天记录一个想法" },
    { type: "set_focus", title: "检查手机布局" },
  ], "整理今天的发布准备");

  assert.equal(planned.tasks.length, 2);
  assert.equal(planned.habits.length, 1);
  assert.equal(planned.tasks.find((task) => task.id === planned.focusTaskId)?.title, "检查手机布局");
  assert.equal(planned.activity.at(-1)?.source, "agent");
  assert.match(planned.activity.at(-1)?.detail ?? "", /3 个动作/);
  assert.match(getTodayKey(new Date(2026, 7, 6)), /^2026-08-06$/);
});

test("video summaries become durable knowledge and optional tasks", () => {
  const capturedUrl = "https://b23.tv/short-link";
  const url = "https://www.bilibili.com/video/BV1test";
  const captured = addInboxItem(createInitialWorkbench(), capturedUrl);
  const saved = saveVideoSummary(captured, {
    capturedUrl,
    url,
    platform: "bilibili",
    sourceId: "BV1test",
    title: "如何建立个人学习系统",
    author: "示例作者",
    description: "",
    duration: 600,
    thumbnail: "",
    transcriptSource: "local-whisper",
    summary: {
      oneSentence: "把输入快速转成可复习的知识与下一步行动。",
      audience: "正在建立个人学习系统的人",
      worthWatching: "包含一条从采集到复习的完整方法。",
      informationDensity: "high",
      keyPoints: [{ title: "先统一入口", detail: "所有材料先进入同一个收件箱。", timestamp: "00:12" }],
      chapters: [{ title: "采集", summary: "先降低输入阻力。", timestamp: "00:00" }],
      concepts: [{ term: "渐进整理", explanation: "需要使用时再增加结构。" }],
      caveats: [],
      creatorInsights: { hook: "从信息焦虑切入", structure: "问题—流程—示例", angles: ["展示真实的一周"] },
      suggestedTasks: [{ title: "整理学习收件箱", note: "只处理最近三条" }],
      cards: [{ title: "渐进整理", content: "结构应在使用中逐步形成。", tags: ["学习系统"] }],
    },
  }, true);

  assert.equal(saved.version, 8);
  assert.equal(saved.videos.length, 1);
  assert.equal(saved.videos[0].transcriptSource, "local-whisper");
  assert.equal(saved.knowledge.length, 1);
  assert.equal(saved.tasks.length, 1);
  assert.equal(saved.inbox[0].status, "planned");
  assert.match(saved.activity.at(-1)?.detail ?? "", /1 张知识卡片 · 1 个任务/);
  const restored = parseWorkbenchState(JSON.stringify(saved));
  assert.equal(restored.videos[0].summary.oneSentence, saved.videos[0].summary.oneSentence);
  assert.equal(restored.videos[0].transcriptSource, "local-whisper");
  const localRestored = parseWorkbenchState(JSON.stringify({
    ...saved,
    videos: [{ ...saved.videos[0], url: "local-media://source-1", platform: "local", localFileName: "课程录音.wav" }],
  }));
  assert.equal(localRestored.videos[0].platform, "local");
  assert.equal(localRestored.videos[0].localFileName, "课程录音.wav");
});

test("grounded knowledge answers persist with citations and remain actionable", () => {
  const initial = createInitialWorkbench();
  const answered = saveKnowledgeInquiry(initial, {
    question: "这些材料对建立学习系统有什么建议？",
    answerable: true,
    answer: "先统一输入入口，再在需要使用时逐步整理。",
    keyPoints: ["统一入口", "渐进整理"],
    gaps: ["还没有长期复习效果的数据"],
    sources: [{
      cardId: "knowledge-1",
      cardTitle: "渐进整理",
      sourceTitle: "如何建立个人学习系统",
      sourceUrl: "https://www.bilibili.com/video/BV1test",
    }],
    suggestedTask: { title: "整理最近三条学习输入", note: "只做归入口，不做复杂分类" },
  });

  assert.equal(answered.version, 8);
  assert.equal(answered.knowledgeInquiries.length, 1);
  assert.equal(answered.knowledgeInquiries[0].sources[0].cardTitle, "渐进整理");
  assert.equal(answered.activity.at(-1)?.label, "保存一次知识问答");
  const restored = parseWorkbenchState(JSON.stringify(answered));
  assert.equal(restored.knowledgeInquiries[0].suggestedTask?.title, "整理最近三条学习输入");
});

test("weekly snapshots count only evidence inside the selected local week", () => {
  const state = {
    ...createInitialWorkbench(),
    tasks: [
      { id: "task-1", title: "完成周回顾", note: "", priority: "high", done: true, source: "manual", createdAt: "2026-08-03T01:00:00.000Z", completedAt: "2026-08-04T02:00:00.000Z" },
      { id: "task-2", title: "下周才做", note: "", priority: "normal", done: false, source: "manual", createdAt: "2026-08-10T01:00:00.000Z", completedAt: null },
    ],
    inbox: [{ id: "inbox-1", content: "研究一个工作台案例", kind: "note", status: "planned", createdAt: "2026-08-05T02:00:00.000Z" }],
    habits: [{ id: "habit-1", name: "每日记录", completedDates: ["2026-08-03", "2026-08-05"] }],
    knowledge: [{ id: "card-1", title: "渐进整理", content: "用时再组织。", tags: ["工作台"], sourceUrl: "https://one.example", sourceTitle: "来源一", createdAt: "2026-08-06T02:00:00.000Z" }],
    activity: [{ id: "activity-1", label: "完成一项任务", detail: "完成周回顾", source: "human", createdAt: "2026-08-04T02:00:00.000Z" }],
  };
  const snapshot = buildWeeklySnapshot(state, new Date(2026, 7, 9, 12));

  assert.equal(snapshot.weekKey, "2026-08-03");
  assert.equal(snapshot.sourceStats.createdTasks, 1);
  assert.equal(snapshot.sourceStats.completedTasks, 1);
  assert.equal(snapshot.sourceStats.capturedItems, 1);
  assert.equal(snapshot.sourceStats.plannedItems, 1);
  assert.equal(snapshot.sourceStats.habitCheckins, 2);
  assert.equal(snapshot.sourceStats.knowledgeCards, 1);
  assert.equal(snapshot.days.reduce((total, day) => total + day.habitCheckins, 0), 2);
  assert.equal(snapshot.openTasks[0].title, "下周才做");
  assert.equal(snapshot.hasEvidence, true);
});

test("weekly reviews upsert by week and survive local state migration", () => {
  const review = {
    weekKey: "2026-08-03",
    periodLabel: "8月3日—8月9日",
    headline: "从输入走到完成",
    summary: "本周完成了一项真实任务，也留下了可以继续复用的知识。",
    wins: ["完成周回顾"],
    friction: ["仍有输入可能等待整理"],
    knowledgeConnections: ["周回顾与渐进整理都强调使用后再组织"],
    nextWeekFocus: "把一个未完成任务推进到可验收状态",
    suggestedActions: [{ title: "完成一个未完成任务", note: "只选择一个" }],
    sourceStats: { completedTasks: 1, createdTasks: 1, capturedItems: 1, plannedItems: 1, habitCheckins: 2, videos: 0, knowledgeCards: 1, knowledgeInquiries: 0 },
  };
  const first = saveWeeklyReview(createInitialWorkbench(), review);
  const updated = saveWeeklyReview(first, { ...review, headline: "一周只有一个方向" });

  assert.equal(first.weeklyReviews.length, 1);
  assert.equal(updated.weeklyReviews.length, 1);
  assert.equal(updated.weeklyReviews[0].headline, "一周只有一个方向");
  assert.equal(updated.activity.at(-1)?.label, "更新本周回顾");
  const restored = parseWorkbenchState(JSON.stringify(updated));
  assert.equal(restored.version, 8);
  assert.equal(restored.weeklyReviews[0].suggestedActions[0].title, "完成一个未完成任务");
});

test("knowledge relations expose cross-source shared evidence and ignore same-source pairs", () => {
  const cards = [
    { id: "a", title: "渐进整理", content: "信息在真正使用时再增加结构。", tags: ["学习系统", "整理"], sourceUrl: "https://one.example", sourceTitle: "来源一", createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "b", title: "低摩擦采集", content: "先统一入口，真正使用时再整理信息。", tags: ["学习系统", "采集"], sourceUrl: "https://two.example", sourceTitle: "来源二", createdAt: "2026-08-02T00:00:00.000Z" },
    { id: "c", title: "同源补充", content: "真正使用时再整理。", tags: ["学习系统"], sourceUrl: "https://one.example", sourceTitle: "来源一", createdAt: "2026-08-03T00:00:00.000Z" },
  ];
  const relations = findKnowledgeRelations(cards, 6);

  assert.ok(relations.some((relation) => relation.leftId === "a" && relation.rightId === "b"));
  assert.ok(relations.every((relation) => !(relation.leftId === "a" && relation.rightId === "c")));
  assert.deepEqual(relations.find((relation) => relation.leftId === "a" && relation.rightId === "b")?.sharedTags, ["学习系统"]);
});

test("personal routes turn confirmed phase actions into tasks or habits", () => {
  const saved = savePersonalRoute(createInitialWorkbench(), {
    name: "稳定发布视频",
    purpose: "把零散灵感推进成可以发布并复盘的视频作品。",
    category: "create",
    accent: "coral",
    cadence: "每次只推进当前阶段",
    successMetric: "留下发布链接与一次真实复盘",
    reflection: "没有假设账号规模或发布日期，需要用户自己调整节奏。",
    phases: [
      {
        title: "形成选题",
        outcome: "得到一个有明确受众和价值承诺的选题",
        completionRule: "写下一句话选题与三条素材证据",
        actions: [
          { title: "写下一句话选题", note: "明确给谁看和解决什么问题", mode: "task" },
          { title: "每天记录一个选题", note: "只记录，不要求展开", mode: "habit" },
        ],
      },
      {
        title: "完成发布",
        outcome: "视频完成发布并留下链接",
        completionRule: "发布链接能够打开",
        actions: [{ title: "完成视频发布", note: "保存发布链接", mode: "task" }],
      },
    ],
  });

  assert.equal(saved.version, 8);
  assert.equal(saved.routes.length, 1);
  const route = saved.routes[0];
  const [taskAction, habitAction] = route.phases[0].actions;
  const withTask = activateRouteAction(saved, route.id, route.phases[0].id, taskAction.id);
  const withHabit = activateRouteAction(withTask, route.id, route.phases[0].id, habitAction.id);

  assert.equal(withHabit.tasks.at(-1)?.title, "写下一句话选题");
  assert.match(withHabit.tasks.at(-1)?.note ?? "", /来自路线/);
  assert.equal(withHabit.habits.at(-1)?.name, "每天记录一个选题");
  assert.ok(withHabit.routes[0].phases[0].actions[0].linkedTaskId);
  assert.ok(withHabit.routes[0].phases[0].actions[1].linkedHabitId);

  const progressed = completeRoutePhase(withHabit, route.id, route.phases[0].id);
  assert.ok(progressed.routes[0].phases[0].completedAt);
  assert.equal(progressed.activity.at(-1)?.label, "完成路线阶段");
  const restored = parseWorkbenchState(JSON.stringify(progressed));
  assert.equal(restored.routes[0].phases[0].actions[0].linkedTaskId, withHabit.routes[0].phases[0].actions[0].linkedTaskId);

  const archived = archivePersonalRoute(restored, route.id);
  assert.ok(archived.routes[0].archivedAt);
});

test("action agent can only activate route actions by real identifiers", () => {
  const saved = savePersonalRoute(createInitialWorkbench(), {
    name: "英语听说训练",
    purpose: "逐步建立能够持续进行的英语输入和口头输出。",
    category: "learn",
    accent: "blue",
    cadence: "按当前阶段轻量重复",
    successMetric: "能够保存一段自己的英语口头表达",
    reflection: "没有假定英语水平，需要后续编辑难度。",
    phases: [{
      title: "建立输入节律",
      outcome: "形成一项可以重复的听力练习",
      completionRule: "至少建立一个真实习惯",
      actions: [{ title: "听一段英语材料", note: "材料由用户选择", mode: "habit" }],
    }],
  });
  const route = saved.routes[0];
  const action = route.phases[0].actions[0];
  const planned = applyAgentActions(saved, [{
    type: "activate_route_action",
    routeId: route.id,
    phaseId: route.phases[0].id,
    actionId: action.id,
  }], "连接当前路线");

  assert.equal(planned.habits.length, 1);
  assert.ok(planned.routes[0].phases[0].actions[0].linkedHabitId);
  const rejected = applyAgentActions(planned, [{
    type: "activate_route_action",
    routeId: "missing",
    phaseId: "missing",
    actionId: "missing",
  }], "拒绝未知路线动作");
  assert.equal(rejected.habits.length, 1);
});

test("personal business boards preserve typed records across schema edits and migration", () => {
  const withRoute = savePersonalRoute(createInitialWorkbench(), {
    name: "稳定内容输出",
    purpose: "把选题推进到真实发布和复盘。",
    category: "create",
    accent: "coral",
    cadence: "每次推进当前阶段",
    successMetric: "留下发布链接和复盘",
    reflection: "需要用户确认平台与频率。",
    phases: [{
      title: "发布内容",
      outcome: "完成一次真实发布",
      completionRule: "保存可打开的发布链接",
      actions: [{ title: "完成一次发布", note: "", mode: "task" }],
    }],
  });
  const routeId = withRoute.routes[0].id;
  const saved = savePersonalBoard(withRoute, {
    name: "内容创作台",
    purpose: "让每个选题从灵感进入制作，发布后留下真实复盘。",
    itemLabel: "选题",
    accent: "coral",
    defaultView: "board",
    reflection: "没有预设用户平台、日期或创作结果。",
    linkedRouteId: routeId,
    statuses: [
      { label: "灵感", tone: "slate", done: false },
      { label: "制作中", tone: "blue", done: false },
      { label: "已发布", tone: "green", done: true },
    ],
    fields: [
      { name: "平台", type: "select", required: true, options: ["B站", "小红书"] },
      { name: "发布日期", type: "date", required: false, options: [] },
      { name: "复盘", type: "text", required: false, options: [] },
    ],
  });

  assert.equal(saved.version, 8);
  assert.equal(saved.boards.length, 1);
  assert.equal(saved.boards[0].linkedRouteId, routeId);
  const board = saved.boards[0];
  const [platformField, dateField] = board.fields;
  const withRecord = addBoardRecord(saved, board.id, {
    title: "工作台路线介绍",
    statusId: board.statuses[0].id,
    values: {
      [platformField.id]: "B站",
      [dateField.id]: "not-a-date",
    },
  });
  const record = withRecord.boards[0].records[0];
  assert.equal(record.values[platformField.id], "B站");
  assert.equal(record.values[dateField.id], "");

  const progressed = updateBoardRecord(withRecord, board.id, record.id, {
    statusId: board.statuses[1].id,
    values: { [dateField.id]: "2026-08-10" },
  });
  assert.equal(progressed.boards[0].records[0].statusId, board.statuses[1].id);
  assert.equal(progressed.boards[0].records[0].values[dateField.id], "2026-08-10");

  const edited = savePersonalBoard(progressed, {
    ...saved.boards[0],
    purpose: "把真实选题推进到制作、发布和复盘，同时保留原始记录。",
  });
  assert.equal(edited.boards[0].records.length, 1);
  assert.equal(edited.boards[0].records[0].title, "工作台路线介绍");
  const restored = parseWorkbenchState(JSON.stringify(edited));
  assert.equal(restored.version, 8);
  assert.equal(restored.boards[0].records[0].values[platformField.id], "B站");

  const withTask = createBoardRecordTask(restored, board.id, record.id);
  assert.equal(withTask.tasks.at(-1)?.title, "工作台路线介绍");
  assert.match(withTask.tasks.at(-1)?.note ?? "", /内容创作台/);
  assert.ok(withTask.boards[0].records[0].linkedTaskId);

  const removed = removeBoardRecord(withTask, board.id, record.id);
  assert.equal(removed.boards[0].records.length, 0);
  const archived = archivePersonalBoard(removed, board.id);
  assert.ok(archived.boards[0].archivedAt);
});

test("action agent board actions require identifiers from the current workspace", () => {
  const saved = savePersonalBoard(createInitialWorkbench(), {
    name: "学习材料台",
    purpose: "记录学习材料并推进学习和复习状态。",
    itemLabel: "学习材料",
    accent: "blue",
    defaultView: "table",
    reflection: "没有假定学习内容与完成情况。",
    linkedRouteId: null,
    statuses: [
      { label: "待学习", tone: "slate", done: false },
      { label: "学习中", tone: "blue", done: false },
      { label: "已掌握", tone: "green", done: true },
    ],
    fields: [{ name: "来源", type: "text", required: false, options: [] }],
  });
  const board = saved.boards[0];
  const added = applyAgentActions(saved, [{
    type: "add_board_record",
    boardId: board.id,
    statusId: board.statuses[0].id,
    title: "BBC Learning English",
  }], "加入明确的学习材料");
  assert.equal(added.boards[0].records.length, 1);

  const record = added.boards[0].records[0];
  const progressed = applyAgentActions(added, [{
    type: "advance_board_record",
    boardId: board.id,
    recordId: record.id,
    statusId: board.statuses[1].id,
  }, {
    type: "create_board_task",
    boardId: board.id,
    recordId: record.id,
  }], "开始学习这份材料");
  assert.equal(progressed.boards[0].records[0].statusId, board.statuses[1].id);
  assert.equal(progressed.tasks.at(-1)?.title, "BBC Learning English");

  const rejected = applyAgentActions(progressed, [{
    type: "advance_board_record",
    boardId: "missing-board",
    recordId: "missing-record",
    statusId: "missing-status",
  }], "拒绝未知业务记录");
  assert.equal(rejected.boards[0].records[0].statusId, board.statuses[1].id);
});

test("creator studio keeps inspiration grounded and closes the loop through tasks, boards, and reviews", () => {
  const profiled = saveCreatorProfile(createInitialWorkbench(), {
    niche: "AI 工作流与个人知识管理",
    audience: "想自己搭工具的独立创作者",
    voice: "具体、克制、有实验感",
    platforms: ["B站", "小红书", "B站"],
  });
  assert.equal(profiled.creator.profile.platforms.length, 2);

  const withSignal = addCreatorSignal(profiled, {
    title: "大家开始展示自己的 AI 工作台",
    url: "https://example.com/source",
    note: "我连续看到三个创作者展示按自己流程定制的页面，但没有可证明的全网热度数据。",
    platform: "小红书",
    observedAt: "2026-08-10",
  });
  const signal = withSignal.creator.signals[0];
  const withIdea = saveCreatorIdea(withSignal, {
    title: "个人工作台真正重要的是反馈回路",
    promise: "看完能判断一个工作台是否真的帮助自己推进事情。",
    hook: "很多 AI 工作台看起来很酷，但三天后你还会打开它吗？",
    angle: "不比较页面数量，只用捕捉、行动和复盘三个真实回路来拆解。",
    format: "video",
    platform: "B站",
    sourceRefs: [{ kind: "signal", id: signal.id, title: "伪造标题", url: "", evidence: "伪造证据" }],
    originalityGuard: "不复刻他人的页面和话术，用自己的工作台记录做演示。",
    reflection: "来源只能证明观察到案例，不能证明它是全网热点。",
    steps: [
      { title: "列出三个反馈回路", note: "只用自己实际使用过的流程" },
      { title: "录制真实演示", note: "展示输入如何变成任务" },
      { title: "补充边界说明", note: "说明哪些数据只在本地" },
    ],
  });
  const idea = withIdea.creator.ideas[0];
  assert.equal(idea.sourceRefs[0].title, signal.title);
  assert.equal(idea.sourceRefs[0].evidence, signal.note);

  const withBoard = savePersonalBoard(withIdea, {
    name: "内容创作台",
    purpose: "把真实选题推进到制作、发布和复盘。",
    itemLabel: "选题",
    accent: "coral",
    defaultView: "board",
    reflection: "平台和发布日期由用户确认。",
    linkedRouteId: null,
    statuses: [
      { label: "灵感", tone: "slate", done: false },
      { label: "制作中", tone: "blue", done: false },
      { label: "已发布", tone: "green", done: true },
    ],
    fields: [
      { name: "平台", type: "select", required: false, options: ["B站", "小红书"] },
      { name: "内容形式", type: "select", required: false, options: ["视频", "图文"] },
    ],
  });
  const board = withBoard.boards[0];
  const connected = addCreatorIdeaToBoard(withBoard, idea.id, board.id);
  assert.equal(connected.boards[0].records[0].title, idea.title);
  assert.equal(connected.boards[0].records[0].values[board.fields[0].id], "B站");
  assert.equal(connected.boards[0].records[0].values[board.fields[1].id], "视频");
  assert.equal(connected.creator.ideas[0].linkedBoardId, board.id);

  const tasked = createCreatorIdeaTask(connected, idea.id);
  assert.equal(tasked.tasks.at(-1)?.title, idea.title);
  assert.match(tasked.tasks.at(-1)?.note ?? "", /创作工作室/);
  assert.equal(tasked.creator.ideas[0].status, "drafting");

  const stepId = tasked.creator.ideas[0].steps[0].id;
  const progressed = updateCreatorIdea(tasked, idea.id, { stepId, stepDone: true, status: "producing" });
  assert.equal(progressed.creator.ideas[0].steps[0].done, true);
  assert.equal(progressed.creator.ideas[0].status, "producing");

  const reviewed = saveCreatorReview(progressed, {
    ideaId: idea.id,
    title: idea.title,
    platform: "B站",
    url: "https://www.bilibili.com/video/BV1example",
    publishedAt: "2026-08-10",
    metrics: { views: 1200, likes: 84, comments: 12, saves: 31, shares: 9, follows: 6 },
    notes: "评论主要追问搭建步骤，无法只凭一条内容判断标题是否有效。",
    analysis: {
      headline: "步骤问题是当前最清晰的反馈",
      observations: [{ claim: "获得 12 条评论与 31 次收藏", metricKeys: ["comments", "saves", "unknown"] }],
      hypotheses: [{ idea: "观众可能更需要实际搭建过程", confidence: "medium" }],
      gaps: ["没有历史内容作为对照"],
      nextExperiment: { change: "下一条只增加完整搭建演示", reason: "验证步骤需求", successSignal: "比较评论是否继续集中追问步骤" },
      reflection: "单条内容不能证明因果。",
    },
  });
  assert.equal(reviewed.creator.ideas[0].status, "published");
  assert.deepEqual(reviewed.creator.reviews[0].analysis.observations[0].metricKeys, ["comments", "saves"]);
  const weekly = buildWeeklySnapshot(reviewed, new Date());
  assert.equal(weekly.sourceStats.creatorIdeas, 1);
  assert.equal(weekly.sourceStats.creatorReviews, 1);
  const restored = parseWorkbenchState(JSON.stringify(reviewed));
  assert.equal(restored.version, 8);
  assert.equal(restored.creator.ideas[0].linkedTaskId, tasked.tasks.at(-1)?.id);
  assert.equal(restored.creator.reviews[0].ideaId, idea.id);

  const withoutSignal = removeCreatorSignal(restored, signal.id);
  assert.equal(withoutSignal.creator.signals.length, 0);
  assert.equal(withoutSignal.creator.ideas[0].sourceRefs.length, 1);
  const withoutReview = removeCreatorReview(withoutSignal, reviewed.creator.reviews[0].id);
  assert.equal(withoutReview.creator.reviews.length, 0);
  const withoutIdea = removeCreatorIdea(withoutReview, idea.id);
  assert.equal(withoutIdea.creator.ideas.length, 0);
});

test("action agent creator actions require real saved idea identifiers", () => {
  const saved = saveCreatorIdea(createInitialWorkbench(), {
    title: "解释一个真实工作流",
    promise: "让观众看懂输入怎样变成行动。",
    hook: "收藏很多内容，为什么还是不知道下一步做什么？",
    angle: "只演示一条从收件箱到今日任务的真实路径。",
    format: "video",
    platform: "B站",
    sourceRefs: [],
    originalityGuard: "只使用自己的工作台和记录。",
    reflection: "这是待验证原创命题，没有外部来源。",
    steps: [
      { title: "写演示脚本", note: "" },
      { title: "录制操作", note: "" },
      { title: "核对隐私", note: "" },
    ],
  });
  const idea = saved.creator.ideas[0];
  const planned = applyAgentActions(saved, [{ type: "create_creator_task", ideaId: idea.id }, { type: "advance_creator_idea", ideaId: idea.id, status: "producing" }], "推进已有选题");
  assert.equal(planned.tasks.length, 1);
  assert.equal(planned.creator.ideas[0].status, "producing");

  const rejected = applyAgentActions(planned, [{ type: "advance_creator_idea", ideaId: "missing", status: "published" }], "拒绝未知选题");
  assert.equal(rejected.creator.ideas[0].status, "producing");
});
