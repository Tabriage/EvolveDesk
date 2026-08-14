import assert from "node:assert/strict";
import test from "node:test";
import { applyBackupMerge, createBackupMergePreview } from "../app/features/backup-merge.mjs";
import { createInitialWorkbench, parseWorkbenchState } from "../app/features/workbench-core.mjs";

const noSources = { transcripts: [], visualFrames: [] };

function task(id, title, done = false) {
  return { id, title, note: "", priority: "normal", done, source: "manual", createdAt: "2026-08-17T08:00:00.000Z", completedAt: done ? "2026-08-17T09:00:00.000Z" : null };
}

function workspace(patch = {}) {
  return parseWorkbenchState(JSON.stringify({ ...createInitialWorkbench(), ...patch }));
}

test("three-way merge preserves independent object additions from both devices", () => {
  const base = workspace({ tasks: [task("task-base", "共同任务")] });
  const local = workspace({ tasks: [task("task-base", "共同任务", true), task("task-local", "本机新增")] });
  const incoming = workspace({ tasks: [task("task-base", "共同任务"), task("task-remote", "另一台设备新增")] });
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, noSources);
  const merged = applyBackupMerge(preview);

  assert.equal(preview.conflictCount, 0);
  assert.equal(preview.autoLocalCount, 2);
  assert.equal(preview.autoIncomingCount, 1);
  assert.deepEqual(merged.workspace.tasks.map((item) => item.id), ["task-base", "task-local", "task-remote"]);
  assert.equal(merged.workspace.tasks[0].done, true);
});

test("concurrent edits to the same stable object require an explicit side", () => {
  const base = workspace({ tasks: [task("task-shared", "原始标题")] });
  const local = workspace({ tasks: [task("task-shared", "本机标题")] });
  const incoming = workspace({ tasks: [task("task-shared", "远端标题")] });
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, noSources);
  const conflict = preview.entries.find((entry) => entry.objectId === "task-shared");

  assert.equal(preview.conflictCount, 1);
  assert.equal(applyBackupMerge(preview).workspace.tasks[0].title, "本机标题");
  assert.equal(applyBackupMerge(preview, { [conflict.key]: "incoming" }).workspace.tasks[0].title, "远端标题");
});

test("delete versus modify is a conflict and can keep the deletion", () => {
  const base = workspace({ tasks: [task("task-delete", "准备删除")] });
  const local = workspace({ tasks: [] });
  const incoming = workspace({ tasks: [task("task-delete", "远端已修改")] });
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, noSources);
  const conflict = preview.entries[0];

  assert.equal(conflict.localState, "不存在");
  assert.equal(conflict.incomingState, "存在");
  assert.equal(applyBackupMerge(preview).workspace.tasks.length, 0);
  assert.equal(applyBackupMerge(preview, { [conflict.key]: "incoming" }).workspace.tasks[0].title, "远端已修改");
});

test("independent source records merge and remain bound to selected videos", () => {
  const video = {
    id: "video-merge",
    url: "https://www.bilibili.com/video/BV1merge",
    platform: "bilibili",
    sourceId: "BV1merge",
    title: "合并证据",
    author: "",
    description: "",
    duration: 60,
    thumbnail: "",
    hasVideo: false,
    width: 0,
    height: 0,
    localFileName: "",
    transcriptSource: "manual",
    visualEvidence: [],
    summary: { oneSentence: "合并", audience: "", worthWatching: "", informationDensity: "medium", keyPoints: [], chapters: [], concepts: [], caveats: [], visualFindings: [], creatorInsights: { hook: "", structure: "", angles: [] }, suggestedTasks: [], cards: [] },
    createdAt: "2026-08-17T08:00:00.000Z",
  };
  const base = workspace({ videos: [video] });
  const local = workspace({ videos: [video] });
  const incoming = workspace({ videos: [video] });
  const localSources = { transcripts: [{ sourceKey: video.url, transcript: "本机字幕", updatedAt: "2026-08-17T09:00:00.000Z" }], visualFrames: [] };
  const incomingSources = { transcripts: [], visualFrames: [] };
  const preview = createBackupMergePreview(base, local, incoming, noSources, localSources, incomingSources);
  const merged = applyBackupMerge(preview);

  assert.equal(preview.conflictCount, 0);
  assert.equal(merged.sources.transcripts[0].transcript, "本机字幕");
});

test("merged state is re-sanitized so orphaned source data cannot survive choices", () => {
  const videoUrl = "https://www.bilibili.com/video/BV1orphan";
  const base = workspace();
  const local = workspace();
  const incoming = workspace();
  const incomingSources = { transcripts: [{ sourceKey: videoUrl, transcript: "没有对应视频", updatedAt: "2026-08-17T09:00:00.000Z" }], visualFrames: [] };
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, incomingSources);
  const merged = applyBackupMerge(preview);

  assert.equal(merged.sources.transcripts.length, 0);
});
