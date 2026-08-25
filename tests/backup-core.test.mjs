import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackupEnvelope,
  compareBackupStates,
  parseBackupText,
  sanitizeBackupSources,
  serializeBackupEnvelope,
  summarizeBackup,
} from "../app/features/backup-core.mjs";
import {
  addTask,
  createInitialWorkbench,
  parseWorkbenchState,
  saveVideoSummary,
} from "../app/features/workbench-core.mjs";

const sourceUrl = "https://www.bilibili.com/video/BV1backup";
const frameData = "data:image/jpeg;base64,/9j/AAAA";

function createFixture() {
  return saveVideoSummary(addTask(createInitialWorkbench(), { title: "迁移前完成预检", source: "manual" }), {
    url: sourceUrl,
    platform: "bilibili",
    sourceId: "BV1backup",
    title: "迁移工作台",
    author: "Evolve Desk",
    description: "",
    duration: 90,
    thumbnail: "",
    hasVideo: true,
    width: 1280,
    height: 720,
    transcriptSource: "manual",
    visualEvidence: [{
      id: "frame-backup-1",
      seconds: 12,
      timestamp: "00:12",
      ocrText: "迁移",
      modelText: "",
      observation: "画面展示迁移入口。",
      uncertainty: "",
    }],
    summary: {
      oneSentence: "先预检，再恢复。",
      audience: "本地优先用户",
      worthWatching: "包含可逆迁移流程。",
      informationDensity: "medium",
      keyPoints: [],
      chapters: [],
      concepts: [],
      caveats: [],
      visualFindings: [{ frameId: "frame-backup-1", timestamp: "00:12", observation: "迁移入口。" }],
      creatorInsights: { hook: "", structure: "", angles: [] },
      suggestedTasks: [],
      cards: [],
    },
  }, false);
}

function fixtureSources() {
  return {
    transcripts: [{ sourceKey: sourceUrl, transcript: "这是一段仅保存在本机的字幕。", updatedAt: "2026-08-14T08:00:00.000Z" }],
    visualFrames: [{ sourceKey: sourceUrl, frames: [{ id: "frame-backup-1", imageDataUrl: frameData }], updatedAt: "2026-08-14T08:00:00.000Z" }],
  };
}

test("backup envelope round-trips workspace and IndexedDB sources with a verified checksum", async () => {
  const workspace = createFixture();
  const envelope = await createBackupEnvelope(workspace, fixtureSources(), "2026-08-14T09:30:00.000Z");
  const serialized = serializeBackupEnvelope(envelope);
  const restored = await parseBackupText(serialized);

  assert.equal(restored.envelope.exportedAt, "2026-08-14T09:30:00.000Z");
  assert.equal(restored.envelope.checksum.length, 64);
  assert.equal(restored.workspace.tasks[0].title, "迁移前完成预检");
  assert.equal(restored.sources.transcripts[0].transcript, "这是一段仅保存在本机的字幕。");
  assert.equal(restored.sources.visualFrames[0].frames[0].id, "frame-backup-1");
  assert.equal(restored.summary.frameCount, 1);
});

test("backup source sanitation drops orphaned records and unreferenced frames", () => {
  const workspace = createFixture();
  const sanitized = sanitizeBackupSources({
    transcripts: [
      ...fixtureSources().transcripts,
      { sourceKey: "https://orphan.example/video", transcript: "不应导入", updatedAt: "today" },
    ],
    visualFrames: [{
      sourceKey: sourceUrl,
      frames: [
        { id: "frame-backup-1", imageDataUrl: frameData },
        { id: "not-in-workspace", imageDataUrl: frameData },
        { id: "bad-data", imageDataUrl: "data:text/plain;base64,bm8=" },
      ],
      updatedAt: "2026-08-14T08:00:00.000Z",
    }],
  }, workspace);

  assert.equal(sanitized.transcripts.length, 1);
  assert.deepEqual(sanitized.visualFrames[0].frames.map((frame) => frame.id), ["frame-backup-1"]);
});

test("backup preview reports stable ID-based additions, removals, and changes", () => {
  const current = addTask(createFixture(), { title: "恢复后应被移除的旧任务", source: "manual" });
  const incoming = parseWorkbenchState(JSON.stringify({
    ...current,
    tasks: [
      { ...current.tasks[0], title: "迁移后复核" },
      { ...current.tasks[0], id: "task-added", title: "检查恢复回执" },
    ],
  }));
  const comparison = compareBackupStates(current, incoming);
  const taskRow = comparison.rows.find((row) => row.key === "tasks");

  assert.deepEqual({ added: taskRow.added, removed: taskRow.removed, changed: taskRow.changed }, { added: 1, removed: 1, changed: 1 });
  assert.equal(summarizeBackup(incoming, fixtureSources()).objectCount > 0, true);
});

test("backup parser rejects modified payloads and future workspace versions", async () => {
  const envelope = await createBackupEnvelope(createFixture(), fixtureSources());
  const modified = structuredClone(envelope);
  modified.payload.workspace.tasks[0].title = "文件已被修改";
  await assert.rejects(parseBackupText(JSON.stringify(modified)), /校验值不一致/);

  const future = structuredClone(envelope);
  future.workspaceVersion = 12;
  future.payload.workspace.version = 12;
  await assert.rejects(parseBackupText(JSON.stringify(future)), /更新版本/);

  const retimed = { ...envelope, exportedAt: "2026-08-14T10:00:00.000Z" };
  await assert.rejects(parseBackupText(JSON.stringify(retimed)), /校验值不一致/);
});

test("backup creation strips unrelated connection settings from workspace input", async () => {
  const workspace = { ...createFixture(), connection: { baseUrl: "http://localhost:62783/v1", apiKey: "must-not-export" } };
  const envelope = await createBackupEnvelope(workspace, fixtureSources());
  const serialized = serializeBackupEnvelope(envelope);

  assert.equal("connection" in envelope.payload.workspace, false);
  assert.equal(serialized.includes("must-not-export"), false);
  assert.equal(serialized.includes("localhost:62783"), false);
});
