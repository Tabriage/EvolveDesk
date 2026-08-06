import assert from "node:assert/strict";
import test from "node:test";
import {
  addInboxItem,
  addTask,
  applyAgentActions,
  createInitialWorkbench,
  getTodayKey,
  inboxKind,
  parseWorkbenchState,
  saveKnowledgeInquiry,
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

  assert.equal(saved.version, 3);
  assert.equal(saved.videos.length, 1);
  assert.equal(saved.videos[0].transcriptSource, "local-whisper");
  assert.equal(saved.knowledge.length, 1);
  assert.equal(saved.tasks.length, 1);
  assert.equal(saved.inbox[0].status, "planned");
  assert.match(saved.activity.at(-1)?.detail ?? "", /1 张知识卡片 · 1 个任务/);
  const restored = parseWorkbenchState(JSON.stringify(saved));
  assert.equal(restored.videos[0].summary.oneSentence, saved.videos[0].summary.oneSentence);
  assert.equal(restored.videos[0].transcriptSource, "local-whisper");
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

  assert.equal(answered.version, 3);
  assert.equal(answered.knowledgeInquiries.length, 1);
  assert.equal(answered.knowledgeInquiries[0].sources[0].cardTitle, "渐进整理");
  assert.equal(answered.activity.at(-1)?.label, "保存一次知识问答");
  const restored = parseWorkbenchState(JSON.stringify(answered));
  assert.equal(restored.knowledgeInquiries[0].suggestedTask?.title, "整理最近三条学习输入");
});
