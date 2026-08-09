import assert from "node:assert/strict";
import test from "node:test";
import {
  addInboxItem,
  addTask,
  applyAgentActions,
  buildWeeklySnapshot,
  createInitialWorkbench,
  findKnowledgeRelations,
  getTodayKey,
  inboxKind,
  parseWorkbenchState,
  saveKnowledgeInquiry,
  saveWeeklyReview,
  saveVideoSummary,
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

  assert.equal(saved.version, 5);
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

  assert.equal(answered.version, 5);
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
  assert.equal(restored.version, 5);
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
