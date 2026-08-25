import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBackupMerge,
  applyBackupMergeChoiceBatch,
  assessBackupMergeDecisionReceiptTrust,
  compareBackupMergeDecisionReceiptToPreview,
  createBackupMergeDecisionReceipt,
  createBackupMergePreview,
  createSignedBackupMergeDecisionReceipt,
  inspectBackupMergeDecisionReceiptText,
  serializeBackupMergeDecisionReceipt,
} from "../app/features/backup-merge.mjs";
import { sha256Text } from "../app/features/backup-core.mjs";
import { createSyncChannel, createSyncIdentity } from "../app/features/sync-core.mjs";
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
  assert.equal(conflict.resolution, "fields");
  assert.deepEqual(conflict.fieldConflicts[0].path, ["title"]);
  assert.equal(applyBackupMerge(preview).workspace.tasks[0].title, "本机标题");
  assert.equal(applyBackupMerge(preview, { [conflict.fieldConflicts[0].key]: "incoming" }).workspace.tasks[0].title, "远端标题");
});

test("different fields on the same object merge without an object-level conflict", () => {
  const baseTask = { ...task("task-fields", "原始标题"), note: "原始备注" };
  const localTask = { ...baseTask, title: "本机标题", priority: "high" };
  const incomingTask = { ...baseTask, note: "迁入备注" };
  const preview = createBackupMergePreview(
    workspace({ tasks: [baseTask] }),
    workspace({ tasks: [localTask] }),
    workspace({ tasks: [incomingTask] }),
    noSources,
    noSources,
    noSources,
  );
  const merged = applyBackupMerge(preview).workspace.tasks[0];

  assert.equal(preview.conflictCount, 0);
  assert.equal(preview.autoFieldMergedCount, 1);
  assert.equal(merged.title, "本机标题");
  assert.equal(merged.note, "迁入备注");
  assert.equal(merged.priority, "high");
});

test("field choices change only the disputed field and preserve automatic fields", () => {
  const baseTask = { ...task("task-mixed", "原始标题"), note: "原始备注" };
  const localTask = { ...baseTask, title: "本机标题", priority: "high" };
  const incomingTask = { ...baseTask, title: "迁入标题", note: "迁入备注" };
  const preview = createBackupMergePreview(workspace({ tasks: [baseTask] }), workspace({ tasks: [localTask] }), workspace({ tasks: [incomingTask] }), noSources, noSources, noSources);
  const conflict = preview.entries.find((entry) => entry.objectId === "task-mixed");
  const titleConflict = conflict.fieldConflicts.find((field) => field.path.join(".") === "title");
  const merged = applyBackupMerge(preview, { [titleConflict.key]: "incoming" }).workspace.tasks[0];

  assert.equal(preview.conflictCount, 1);
  assert.equal(merged.title, "迁入标题");
  assert.equal(merged.note, "迁入备注");
  assert.equal(merged.priority, "high");
});

test("scoped batch choices fill only unresolved conflicts and preserve manual decisions", () => {
  const base = workspace({ tasks: [task("task-batch-a", "原始 A"), task("task-batch-b", "原始 B")] });
  const local = workspace({ tasks: [task("task-batch-a", "本机 A"), task("task-batch-b", "本机 B")] });
  const incoming = workspace({ tasks: [task("task-batch-a", "迁入 A"), task("task-batch-b", "迁入 B")] });
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, noSources);
  const [first, second] = preview.conflictKeys;
  const batch = applyBackupMergeChoiceBatch(preview, { [first]: "local" }, [first, second, second], "incoming");

  assert.deepEqual(batch.appliedKeys, [second]);
  assert.equal(batch.choices[first], "local");
  assert.equal(batch.choices[second], "incoming");
  assert.throws(() => applyBackupMergeChoiceBatch(preview, {}, ["tasks:not-in-preview"], "local"), /当前预览之外/);
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

test("merge decision receipts seal choices without copying disputed content", async () => {
  const base = workspace({ tasks: [task("task-receipt", "原始秘密标题")] });
  const local = workspace({ tasks: [task("task-receipt", "本机秘密标题")] });
  const incoming = workspace({ tasks: [task("task-receipt", "迁入秘密标题")] });
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, noSources);
  const field = preview.entries[0].fieldConflicts[0];
  const context = {
    baseRevisionId: "revision_base",
    localRevisionId: "revision_local",
    incomingRevisionId: "revision_incoming",
    sourceChecksum: "c".repeat(64),
  };
  const receipt = await createBackupMergeDecisionReceipt(preview, { [field.key]: "incoming" }, context, "2026-08-22T08:00:00.000Z");
  const inspection = await inspectBackupMergeDecisionReceiptText(serializeBackupMergeDecisionReceipt(receipt));
  const comparison = await compareBackupMergeDecisionReceiptToPreview(inspection.receipt, preview, context);

  assert.equal(receipt.format, "evolve-desk.merge-decision");
  assert.equal(receipt.formatVersion, 2);
  assert.match(receipt.receiptId, /^decision_[0-9a-f]{32}$/);
  assert.match(receipt.integrity.digest, /^[0-9a-f]{64}$/);
  assert.equal(receipt.totals.conflictDecisions, 1);
  assert.equal(receipt.decisions[0].fields[0].choice, "incoming");
  assert.deepEqual(receipt.decisions[0].fields[0].path, ["title"]);
  assert.equal(JSON.stringify(receipt).includes("秘密标题"), false);
  assert.equal(inspection.sealed, true);
  assert.equal(comparison.matches, true);
  await assert.rejects(
    createBackupMergeDecisionReceipt(preview, {}, context, "2026-08-22T08:00:00.000Z"),
    /1 个合并冲突没有明确选择/,
  );
});

test("offline receipt inspection rejects modified choices and detects another merge context", async () => {
  const base = workspace({ tasks: [task("task-receipt-check", "原始")] });
  const local = workspace({ tasks: [task("task-receipt-check", "本机")] });
  const incoming = workspace({ tasks: [task("task-receipt-check", "迁入")] });
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, noSources);
  const field = preview.entries[0].fieldConflicts[0];
  const context = { baseRevisionId: "revision_base", localRevisionId: "revision_local", incomingRevisionId: "revision_incoming", sourceChecksum: "d".repeat(64) };
  const receipt = await createBackupMergeDecisionReceipt(preview, { [field.key]: "local" }, context, "2026-08-22T09:00:00.000Z");
  const tampered = structuredClone(receipt);
  tampered.decisions[0].fields[0].choice = "incoming";

  await assert.rejects(inspectBackupMergeDecisionReceiptText(JSON.stringify(tampered)), /完整性封签不一致/);
  const hidden = structuredClone(receipt);
  hidden.decisions[0].fields[0].value = "不应进入回执的内容";
  await assert.rejects(inspectBackupMergeDecisionReceiptText(JSON.stringify(hidden)), /缺失或未声明字段/);
  const inspection = await inspectBackupMergeDecisionReceiptText(serializeBackupMergeDecisionReceipt(receipt));
  const mismatch = await compareBackupMergeDecisionReceiptToPreview(inspection.receipt, preview, { ...context, incomingRevisionId: "revision_another" });
  assert.equal(mismatch.matches, false);
  assert.equal(mismatch.contextMatches, false);
  assert.equal(mismatch.conflictSetMatches, true);
  const anotherPreview = createBackupMergePreview(
    workspace({ tasks: [{ ...task("task-receipt-check", "原始"), note: "原始备注" }] }),
    workspace({ tasks: [{ ...task("task-receipt-check", "原始"), note: "本机备注" }] }),
    workspace({ tasks: [{ ...task("task-receipt-check", "原始"), note: "迁入备注" }] }),
    noSources,
    noSources,
    noSources,
  );
  const wrongConflictSet = await compareBackupMergeDecisionReceiptToPreview(inspection.receipt, anotherPreview, context);
  assert.equal(wrongConflictSet.contextMatches, true);
  assert.equal(wrongConflictSet.conflictSetMatches, false);
  assert.equal(wrongConflictSet.matches, false);
});

test("device-signed receipts verify offline and bind trust to the exact sync space", async () => {
  const identity = await createSyncIdentity("签发设备", "2026-08-22T09:30:00.000Z");
  const channel = await createSyncChannel(identity, "审计空间", "2026-08-22T09:31:00.000Z");
  const base = workspace({ tasks: [task("task-signed", "原始")] });
  const local = workspace({ tasks: [task("task-signed", "本机")] });
  const incoming = workspace({ tasks: [task("task-signed", "迁入")] });
  const preview = createBackupMergePreview(base, local, incoming, noSources, noSources, noSources);
  const field = preview.entries[0].fieldConflicts[0];
  const context = {
    channelId: channel.channelId,
    baseRevisionId: "revision_base",
    localRevisionId: "revision_local",
    incomingRevisionId: "revision_incoming",
    sourceChecksum: "e".repeat(64),
  };
  const receipt = await createSignedBackupMergeDecisionReceipt(preview, { [field.key]: "incoming" }, context, identity, "2026-08-22T09:32:00.000Z");
  const inspection = await inspectBackupMergeDecisionReceiptText(serializeBackupMergeDecisionReceipt(receipt));
  const trusted = await assessBackupMergeDecisionReceiptTrust(inspection.receipt, [channel]);
  const unknown = await assessBackupMergeDecisionReceiptTrust(inspection.receipt, []);
  const stranger = await createSyncIdentity("未授权设备", "2026-08-22T09:33:00.000Z");
  const untrusted = await assessBackupMergeDecisionReceiptTrust(inspection.receipt, [{
    ...channel,
    authorizedDevices: [{ ...stranger.device, authorizedAt: "2026-08-22T09:34:00.000Z", authorizedBy: stranger.device.deviceId }],
  }]);
  const comparison = await compareBackupMergeDecisionReceiptToPreview(inspection.receipt, preview, context);

  assert.equal(receipt.formatVersion, 3);
  assert.equal(receipt.context.channelId, channel.channelId);
  assert.equal(receipt.signer.fingerprint, identity.device.fingerprint);
  assert.equal(inspection.sealed, true);
  assert.equal(inspection.signed, true);
  assert.equal(inspection.signatureValid, true);
  assert.equal(trusted.trusted, true);
  assert.equal(trusted.channelLabel, "审计空间");
  assert.equal(unknown.trusted, false);
  assert.equal(unknown.channelKnown, false);
  assert.equal(untrusted.trusted, false);
  assert.equal(untrusted.channelKnown, true);
  assert.equal(comparison.matches, true);
});

test("a recomputed SHA seal cannot forge a device-signed receipt", async () => {
  const identity = await createSyncIdentity("原签发设备", "2026-08-22T09:40:00.000Z");
  const channel = await createSyncChannel(identity, "防伪空间", "2026-08-22T09:41:00.000Z");
  const preview = createBackupMergePreview(
    workspace({ tasks: [task("task-forgery", "原始")] }),
    workspace({ tasks: [task("task-forgery", "本机")] }),
    workspace({ tasks: [task("task-forgery", "迁入")] }),
    noSources,
    noSources,
    noSources,
  );
  const field = preview.entries[0].fieldConflicts[0];
  const receipt = await createSignedBackupMergeDecisionReceipt(preview, { [field.key]: "local" }, {
    channelId: channel.channelId,
    baseRevisionId: "revision_base",
    localRevisionId: "revision_local",
    incomingRevisionId: "revision_incoming",
    sourceChecksum: "f".repeat(64),
  }, identity, "2026-08-22T09:42:00.000Z");
  const forged = structuredClone(receipt);
  forged.decisions[0].fields[0].choice = "incoming";
  const content = structuredClone(forged);
  delete content.receiptId;
  delete content.integrity;
  delete content.proof;
  const digest = await sha256Text(JSON.stringify(content));
  forged.receiptId = `decision_${digest.slice(0, 32)}`;
  forged.integrity = { algorithm: "SHA-256", digest };

  await assert.rejects(inspectBackupMergeDecisionReceiptText(JSON.stringify(forged)), /设备声明签名无效/);
});

test("legacy decision receipts remain structurally inspectable but are clearly unsealed", async () => {
  const legacy = {
    format: "evolve-desk.merge-decision",
    formatVersion: 1,
    createdAt: "2026-08-22T10:00:00.000Z",
    context: { baseRevisionId: "revision_base", localRevisionId: "revision_local", incomingRevisionId: "revision_incoming", sourceChecksum: "legacy-checksum" },
    totals: { conflictDecisions: 1, autoLocalObjects: 0, autoIncomingObjects: 0, fieldMergedObjects: 1 },
    decisions: [{ categoryKey: "tasks", objectId: "task-legacy", resolution: "fields", fields: [{ path: ["title"], choice: "local" }] }],
  };
  const inspection = await inspectBackupMergeDecisionReceiptText(`${JSON.stringify(legacy)}\n`);
  assert.equal(inspection.sealed, false);
  assert.equal(inspection.signed, false);
  assert.equal(inspection.digest, "");
  assert.equal(inspection.conflictDecisions, 1);
});
