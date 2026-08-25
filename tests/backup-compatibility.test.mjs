import assert from "node:assert/strict";
import test from "node:test";
import { inspectBackupCompatibility } from "../app/features/backup-compatibility.mjs";
import { BACKUP_FORMAT, createBackupEnvelope, serializeBackupEnvelope, sha256Text } from "../app/features/backup-core.mjs";
import { addTask, createInitialWorkbench } from "../app/features/workbench-core.mjs";

const noSources = { transcripts: [], visualFrames: [] };

async function signedEnvelope(workspaceVersion, workspace, sources = noSources, exportedAt = "2026-08-18T08:00:00.000Z") {
  const content = { format: BACKUP_FORMAT, formatVersion: 1, workspaceVersion, exportedAt, payload: { workspace, sources } };
  return `${JSON.stringify({ ...content, checksumAlgorithm: "SHA-256", checksum: await sha256Text(JSON.stringify(content)) }, null, 2)}\n`;
}

test("current canonical backups pass compatibility checks without migration warnings", async () => {
  const state = addTask(createInitialWorkbench(), { title: "检查当前格式", source: "manual" });
  const raw = serializeBackupEnvelope(await createBackupEnvelope(state, noSources, "2026-08-18T08:00:00.000Z"));
  const { report } = await inspectBackupCompatibility(raw);

  assert.equal(report.status, "ready");
  assert.equal(report.sourceVersion, 11);
  assert.equal(report.migrationRequired, false);
  assert.equal(report.warningCount, 0);
});

test("older workspace versions receive an explicit migration report", async () => {
  const oldWorkspace = {
    version: 3,
    tasks: [{ id: "task-old", title: "来自旧版本", note: "", priority: "normal", done: false, source: "manual", createdAt: "2026-08-18T07:00:00.000Z", completedAt: null }],
  };
  const { parsed, report } = await inspectBackupCompatibility(await signedEnvelope(3, oldWorkspace));

  assert.equal(report.status, "migration");
  assert.equal(report.sourceVersion, 3);
  assert.equal(report.targetVersion, 11);
  assert.equal(report.migrationRequired, true);
  assert.equal(parsed.workspace.tasks[0].title, "来自旧版本");
});

test("compatibility checks disclose dropped orphan sources before restore", async () => {
  const workspace = createInitialWorkbench();
  const sources = {
    transcripts: [{ sourceKey: "https://orphan.example/video", transcript: "没有对应视频的字幕", updatedAt: "2026-08-18T07:00:00.000Z" }],
    visualFrames: [],
  };
  const { report } = await inspectBackupCompatibility(await signedEnvelope(11, workspace, sources));
  const transcriptChange = report.changes.find((change) => change.key === "transcripts");

  assert.equal(report.status, "attention");
  assert.equal(report.droppedObjects, 1);
  assert.equal(transcriptChange.before, 1);
  assert.equal(transcriptChange.after, 0);
  assert.equal(transcriptChange.severity, "warning");
});

test("compatibility checks report repaired dangling focus references", async () => {
  const workspace = { ...createInitialWorkbench(), focusTaskId: "task-missing" };
  const { report } = await inspectBackupCompatibility(await signedEnvelope(11, workspace));

  assert.equal(report.repairedReferences, 1);
  assert.equal(report.changes.some((change) => change.key === "references"), true);
});
