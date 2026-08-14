"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { SyncStudio } from "./SyncStudio";
import type { StagedSyncBackup, StagedSyncMergeBase } from "./SyncStudio";
import { applyBackupMerge, createBackupMergeDecisionReceipt, createBackupMergePreview } from "../features/backup-merge.mjs";
import type { BackupMergeChoice, BackupMergeDecisionReceipt, BackupMergePreview } from "../features/backup-merge.mjs";
import { inspectBackupCompatibility } from "../features/backup-compatibility.mjs";
import type { BackupCompatibilityReport } from "../features/backup-compatibility.mjs";
import {
  BACKUP_KDF_ITERATIONS,
  MAX_ENCRYPTED_BACKUP_BYTES,
  decryptBackupEnvelope,
  encryptBackupText,
  inspectEncryptedBackupText,
  serializeEncryptedBackupEnvelope,
} from "../features/backup-crypto.mjs";
import type { EncryptedBackupEnvelope } from "../features/backup-crypto.mjs";
import {
  MAX_BACKUP_BYTES,
  compareBackupStates,
  createBackupEnvelope,
  serializeBackupEnvelope,
  summarizeBackup,
} from "../features/backup-core.mjs";
import type {
  BackupDiff,
  BackupEnvelope,
  BackupSources,
  BackupSummary,
} from "../features/backup-core.mjs";
import { exportSourceArchive, replaceSourceArchive } from "../features/transcript-store.mjs";
import { setSyncChannelHead } from "../features/sync-device-store.mjs";
import type { WorkbenchState } from "../features/workbench-core.mjs";

type DataVaultProps = {
  state: WorkbenchState;
  onRestore: (state: WorkbenchState) => void;
};

type PendingBackup = {
  fileName: string;
  fileBytes: number;
  envelope: BackupEnvelope;
  workspace: WorkbenchState;
  sources: BackupSources;
  summary: BackupSummary;
  diff: BackupDiff;
  protected: boolean;
  sync?: StagedSyncBackup;
  merge?: BackupMergePreview;
  compatibility: BackupCompatibilityReport;
};

type LockedBackup = {
  fileName: string;
  fileBytes: number;
  envelope: EncryptedBackupEnvelope;
};

type UndoSnapshot = {
  workspace: WorkbenchState;
  sources: BackupSources;
  restoredAt: string;
  fileName: string;
  sync?: {
    channelId: string;
    headRevisionId: string;
    lastPacketAt: string;
    mergeParentRevisionIds: string[];
  };
};

type ExportReceipt = {
  exportedAt: string;
  checksum: string;
  bytes: number;
  summary: BackupSummary;
  protected: boolean;
};

type RestoreReceipt = {
  fileName: string;
  restoredAt: string;
  checksum: string;
  merged: boolean;
  mergeDecision?: BackupMergeDecisionReceipt;
};

const summaryLabels: Record<string, string> = {
  tasks: "任务",
  inbox: "收件箱",
  habits: "习惯",
  routes: "路线",
  boards: "业务台",
  creatorIdeas: "选题",
  videos: "视频",
  knowledge: "知识卡",
  learningTopics: "专题",
  studyCards: "复习卡",
  weeklyReviews: "周回顾",
  activity: "活动记忆",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function describeMergeValue(value: unknown) {
  if (value === undefined) return "删除这个对象";
  if (value === null) return "空值";
  if (typeof value !== "object") return String(value).slice(0, 180) || "空值";
  const source = value as Record<string, unknown>;
  const preferred = ["title", "name", "content", "question", "prompt", "status", "done", "updatedAt", "completedAt"];
  const keys = [...preferred.filter((key) => key in source), ...Object.keys(source).filter((key) => !preferred.includes(key) && !["id", "createdAt"].includes(key))];
  const parts: string[] = [];
  for (const key of keys) {
    const item = source[key];
    if (item === "" || item === null || item === undefined) continue;
    const rendered = Array.isArray(item)
      ? `${item.length} 项`
      : typeof item === "object" ? `${Object.keys(item as object).length} 个字段` : String(item);
    parts.push(`${key}: ${rendered.slice(0, 90)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ") || "保留这个对象";
}

function backupFileName(date = new Date(), protectedBackup = false) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  const kind = protectedBackup ? "protected" : "backup";
  return `evolve-desk-${kind}-${read("year")}-${read("month")}-${read("day")}-${read("hour")}${read("minute")}.json`;
}

export function DataVault({ state, onRestore }: DataVaultProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [localSources, setLocalSources] = useState<BackupSources>({ transcripts: [], visualFrames: [] });
  const [busy, setBusy] = useState<"" | "export" | "read" | "decrypt" | "restore" | "undo">("");
  const [message, setMessage] = useState("迁移文件只在你的浏览器里生成和读取，不经过模型或服务器。 ");
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [lockedBackup, setLockedBackup] = useState<LockedBackup | null>(null);
  const [restoreArmed, setRestoreArmed] = useState(false);
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);
  const [lastExport, setLastExport] = useState<ExportReceipt | null>(null);
  const [restoreReceipt, setRestoreReceipt] = useState<RestoreReceipt | null>(null);
  const [exportProtection, setExportProtection] = useState<"plain" | "encrypted">("encrypted");
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState("");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [mergeMode, setMergeMode] = useState<"merge" | "replace">("merge");
  const [mergeChoices, setMergeChoices] = useState<Record<string, BackupMergeChoice>>({});

  useEffect(() => {
    let active = true;
    exportSourceArchive().then((sources) => {
      if (active) setLocalSources(sources);
    }).catch(() => {
      if (active) setMessage("工作台可用，但暂时无法读取本地字幕与画面库。 ");
    });
    return () => { active = false; };
  }, [state.videos]);

  const currentSummary = useMemo(() => summarizeBackup(state, localSources), [state, localSources]);
  const visibleModules = Object.entries(currentSummary.modules).filter(([, count]) => count > 0);
  const mergedBackup = useMemo(() => pending?.merge ? applyBackupMerge(pending.merge, mergeChoices) : null, [pending, mergeChoices]);
  const unresolvedMergeCount = useMemo(() => pending?.merge ? pending.merge.conflictKeys.filter((key) => !(key in mergeChoices)).length : 0, [pending, mergeChoices]);
  const previewWorkspace = pending ? pending.merge && mergeMode === "merge" && mergedBackup ? mergedBackup.workspace : pending.workspace : null;
  const previewSummary = pending ? pending.merge && mergeMode === "merge" && mergedBackup ? mergedBackup.summary : pending.summary : null;
  const previewDiff = useMemo(() => previewWorkspace ? compareBackupStates(state, previewWorkspace) : null, [state, previewWorkspace]);

  function stagePreview(raw: string, fileName: string, fileBytes: number, protectedBackup: boolean, sync?: StagedSyncBackup, mergeBase?: StagedSyncMergeBase) {
    return inspectBackupCompatibility(raw).then(({ parsed, report: compatibility }) => {
      const diff = compareBackupStates(state, parsed.workspace);
      const merge = sync?.relation === "diverged" && mergeBase
        ? createBackupMergePreview(mergeBase.workspace, state, parsed.workspace, mergeBase.sources, localSources, parsed.sources)
        : undefined;
      setMergeMode(merge ? "merge" : "replace");
      setMergeChoices({});
      setPending({
        fileName,
        fileBytes,
        envelope: parsed.envelope,
        workspace: parsed.workspace,
        sources: parsed.sources,
        summary: parsed.summary,
        diff,
        protected: protectedBackup,
        sync,
        merge,
        compatibility,
      });
    });
  }

  async function stageSyncBackup(raw: string, fileName: string, fileBytes: number, sync: StagedSyncBackup, mergeBase?: StagedSyncMergeBase) {
    setPending(null);
    setLockedBackup(null);
    setRestoreArmed(false);
    await stagePreview(raw, fileName, fileBytes, false, sync, mergeBase);
    setMessage(sync.relation === "diverged"
      ? mergeBase
        ? "同步包通过校验并找到共同父版本；请审阅自动合并与逐对象冲突。 "
        : "同步包通过校验但缺少共同父版本；下方只做整体替换预览，不会猜测合并。 "
      : "同步包通过加密、来源和内层校验。当前工作台尚未被修改。 ");
  }

  async function exportBackup() {
    setBusy("export");
    setRestoreArmed(false);
    setMessage("正在封装工作台、字幕与画面底片…");
    try {
      const sources = await exportSourceArchive();
      const envelope = await createBackupEnvelope(state, sources);
      const plainText = serializeBackupEnvelope(envelope);
      const protectedBackup = exportProtection === "encrypted";
      let serialized = plainText;
      if (protectedBackup) {
        if (exportPassphrase !== exportPassphraseConfirm) throw new Error("两次输入的保护口令不一致");
        const protectedEnvelope = await encryptBackupText(plainText, exportPassphrase);
        serialized = serializeEncryptedBackupEnvelope(protectedEnvelope);
      }
      const blob = new Blob([serialized], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backupFileName(new Date(envelope.exportedAt), protectedBackup);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      const summary = summarizeBackup(state, sources);
      setLocalSources(sources);
      setLastExport({ exportedAt: envelope.exportedAt, checksum: envelope.checksum, bytes: blob.size, summary, protected: protectedBackup });
      if (protectedBackup) {
        setExportPassphrase("");
        setExportPassphraseConfirm("");
        setMessage("加密迁移卷已生成；口令没有保存，跨设备恢复时必须再次输入。 ");
      } else {
        setMessage("标准迁移卷已生成；请只把它放进你信任的磁盘或加密空间。 ");
      }
    } catch (error) {
      if (exportProtection === "encrypted") {
        setExportPassphrase("");
        setExportPassphraseConfirm("");
      }
      setMessage(error instanceof Error ? error.message : "生成迁移卷失败");
    } finally {
      setBusy("");
    }
  }

  async function readBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("read");
    setPending(null);
    setLockedBackup(null);
    setUnlockPassphrase("");
    setExportPassphrase("");
    setExportPassphraseConfirm("");
    setRestoreArmed(false);
    setMessage("正在本地核对格式、版本与完整性校验…");
    try {
      if (file.size > MAX_ENCRYPTED_BACKUP_BYTES) throw new Error("迁移卷超过 132MB 上限");
      const raw = await file.text();
      const protectedEnvelope = inspectEncryptedBackupText(raw);
      if (protectedEnvelope) {
        setLockedBackup({ fileName: file.name, fileBytes: file.size, envelope: protectedEnvelope });
        setMessage("识别到加密迁移卷。输入保护口令后才会解锁并生成差异预检。 ");
      } else {
        if (file.size > MAX_BACKUP_BYTES) throw new Error("标准迁移卷超过 96MB 上限");
        await stagePreview(raw, file.name, file.size, false);
        setMessage("预检通过。当前工作台尚未被修改，请先核对下方差异。 ");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取这份备份");
    } finally {
      setBusy("");
    }
  }

  async function unlockBackup() {
    if (!lockedBackup) return;
    setBusy("decrypt");
    setRestoreArmed(false);
    setMessage("正在当前页面内存中派生密钥并解锁迁移卷…");
    try {
      const plaintext = await decryptBackupEnvelope(lockedBackup.envelope, unlockPassphrase);
      await stagePreview(plaintext, lockedBackup.fileName, lockedBackup.fileBytes, true);
      setLockedBackup(null);
      setUnlockPassphrase("");
      setMessage("加密卷已解锁并通过内层校验。当前工作台尚未被修改。 ");
    } catch (error) {
      setUnlockPassphrase("");
      setMessage(error instanceof Error ? error.message : "无法解锁这份迁移卷");
    } finally {
      setBusy("");
    }
  }

  function discardLockedBackup() {
    setLockedBackup(null);
    setUnlockPassphrase("");
    setMessage("已丢弃加密卷，没有解锁或写入任何数据。 ");
  }

  async function restoreBackup() {
    if (!pending) return;
    const useMerge = Boolean(pending.merge && mergeMode === "merge" && mergedBackup);
    const targetWorkspace = useMerge ? mergedBackup!.workspace : pending.workspace;
    const targetSources = useMerge ? mergedBackup!.sources : pending.sources;
    if (useMerge && unresolvedMergeCount > 0) {
      setRestoreArmed(false);
      setMessage(`还有 ${unresolvedMergeCount} 个冲突字段或对象尚未明确选择，完成后才能写入合并。`);
      return;
    }
    if (!restoreArmed) {
      setRestoreArmed(true);
      setMessage(useMerge
        ? "已进入确认状态：再次点击会写入上方逐对象合并结果，并保留本次撤回快照。 "
        : "已进入确认状态：再次点击会用迁移卷整体替换当前本地工作台。 ");
      return;
    }
    setBusy("restore");
    setMessage(useMerge ? "正在建立恢复前快照，并写入三方合并结果…" : "正在建立恢复前快照，并写入迁移卷…");
    let previousSources: BackupSources | null = null;
    try {
      const restoredAt = new Date().toISOString();
      const mergeDecision = useMerge && pending.merge ? createBackupMergeDecisionReceipt(pending.merge, mergeChoices, {
        baseRevisionId: pending.sync?.parentRevisionId || "",
        localRevisionId: pending.sync?.previousHeadRevisionId || "",
        incomingRevisionId: pending.sync?.revisionId || "",
        sourceChecksum: pending.envelope.checksum,
      }, restoredAt) : undefined;
      previousSources = await exportSourceArchive();
      const previousWorkspace = state;
      const replaced = await replaceSourceArchive(targetSources);
      if (!replaced) throw new Error("当前浏览器不支持本地媒体库恢复");
      try {
        onRestore(targetWorkspace);
      } catch (error) {
        await replaceSourceArchive(previousSources);
        throw error;
      }
      let syncHeadSaved = true;
      if (pending.sync) {
        try {
          const mergeParents = useMerge && pending.sync.previousHeadRevisionId && pending.sync.previousHeadRevisionId !== pending.sync.revisionId
            ? [pending.sync.previousHeadRevisionId]
            : [];
          const updated = await setSyncChannelHead(pending.sync.channelId, pending.sync.revisionId, restoredAt, mergeParents);
          syncHeadSaved = Boolean(updated);
        } catch {
          syncHeadSaved = false;
        }
      }
      setUndo({
        workspace: previousWorkspace,
        sources: previousSources,
        restoredAt,
        fileName: pending.fileName,
        sync: pending.sync ? {
          channelId: pending.sync.channelId,
          headRevisionId: pending.sync.previousHeadRevisionId,
          lastPacketAt: pending.sync.previousLastPacketAt,
          mergeParentRevisionIds: pending.sync.previousMergeParentRevisionIds,
        } : undefined,
      });
      setLocalSources(targetSources);
      setRestoreReceipt({ fileName: pending.fileName, restoredAt, checksum: pending.envelope.checksum, merged: useMerge, mergeDecision });
      setPending(null);
      setRestoreArmed(false);
      setMessage(syncHeadSaved
        ? useMerge
          ? "三方合并已写入；下一次生成同步包会带上两条父版本线。刷新前仍可一步撤回。 "
          : "恢复完成。关闭或刷新页面前，你仍可一步撤回到恢复前状态。 "
        : "数据已恢复，但同步版本头未能写入本地密钥库；请保留原同步包并刷新后检查。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败，原工作台未被替换");
    } finally {
      setBusy("");
    }
  }

  async function undoRestore() {
    if (!undo) return;
    setBusy("undo");
    setMessage("正在撤回整次恢复…");
    try {
      const currentSources = await exportSourceArchive();
      const replaced = await replaceSourceArchive(undo.sources);
      if (!replaced) throw new Error("当前浏览器不支持本地媒体库恢复");
      try {
        onRestore(undo.workspace);
      } catch (error) {
        await replaceSourceArchive(currentSources);
        throw error;
      }
      let syncHeadRestored = true;
      if (undo.sync) {
        try {
          const updated = await setSyncChannelHead(undo.sync.channelId, undo.sync.headRevisionId, undo.sync.lastPacketAt, undo.sync.mergeParentRevisionIds);
          syncHeadRestored = Boolean(updated);
        } catch {
          syncHeadRestored = false;
        }
      }
      setLocalSources(undo.sources);
      setUndo(null);
      setRestoreReceipt(null);
      setMessage(syncHeadRestored
        ? "已撤回恢复，工作台与同步版本头都回到导入之前。 "
        : "工作台数据已撤回，但同步版本头未能恢复；请保留原文件并刷新检查。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤回失败，当前状态保持不变");
    } finally {
      setBusy("");
    }
  }

  function discardPreview() {
    setPending(null);
    setMergeChoices({});
    setRestoreArmed(false);
    setMessage("已丢弃预检结果，没有写入任何数据。 ");
  }

  function chooseMergeSide(key: string, choice: BackupMergeChoice) {
    setMergeChoices((current) => ({ ...current, [key]: choice }));
    setRestoreArmed(false);
  }

  function downloadMergeDecision(receipt: BackupMergeDecisionReceipt) {
    const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([serialized], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `evolve-merge-decision-${receipt.createdAt.replace(/[-:]/g, "").slice(0, 13)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section className="data-vault">
      <div className="workspace-heading vault-heading">
        <div><p className="eyebrow">迁移舱 · LOCAL DATA VAULT</p><h1>把这台设备的工作，<em>封成一份可核验的迁移卷。</em></h1></div>
        <span className="vault-local-seal"><i /> LOCAL ONLY</span>
      </div>

      <ol className="vault-film" aria-label="迁移阶段">
        <li className="active"><i>01</i><div><small>CURRENT</small><strong>当前底片</strong><span>{currentSummary.objectCount} 个对象</span></div></li>
        <li className={lastExport || pending || lockedBackup ? "active" : ""}><i>02</i><div><small>ARCHIVE</small><strong>迁移卷</strong><span>{lockedBackup ? "等待解锁" : pending ? "已通过预检" : lastExport?.protected ? "加密卷已生成" : lastExport ? "标准卷已生成" : "等待生成"}</span></div></li>
        <li className={pending ? "active warning" : restoreReceipt ? "active restored" : ""}><i>03</i><div><small>RESTORE</small><strong>恢复位</strong><span>{pending ? "尚未写入" : restoreReceipt ? "恢复完成" : "需要确认"}</span></div></li>
      </ol>

      <div className="vault-message" role="status"><i className={busy ? "working" : ""} /><span>{message}</span><code>{busy ? "WORKING" : lockedBackup ? "LOCKED" : pending ? "PREVIEW" : "READY"}</code></div>

      <div className="vault-actions-grid">
        <article className="vault-action-card export">
          <header><span>OUT / 01</span><i>↗</i></header>
          <h2>导出整台工作台</h2>
          <p>打包任务、路线、知识、复习、活动记忆，以及浏览器里的字幕和采样帧。</p>
          <div className="vault-protection-choice" role="radiogroup" aria-label="迁移卷保护方式">
            <button className={exportProtection === "encrypted" ? "active" : ""} role="radio" aria-checked={exportProtection === "encrypted"} onClick={() => setExportProtection("encrypted")}><i>⌾</i><span><strong>口令加密卷</strong><small>跨设备移动时使用</small></span></button>
            <button className={exportProtection === "plain" ? "active" : ""} role="radio" aria-checked={exportProtection === "plain"} onClick={() => { setExportProtection("plain"); setExportPassphrase(""); setExportPassphraseConfirm(""); }}><i>○</i><span><strong>标准迁移卷</strong><small>仅放在可信空间</small></span></button>
          </div>
          {exportProtection === "encrypted" && (
            <div className="vault-passphrase-fields">
              <label><span>保护口令</span><input type="password" value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} autoComplete="new-password" placeholder="至少 12 个字符，建议使用多个无关词" /></label>
              <label><span>再次输入</span><input type="password" value={exportPassphraseConfirm} onChange={(event) => setExportPassphraseConfirm(event.target.value)} autoComplete="new-password" placeholder="再次输入同一口令" /></label>
              <p className={exportPassphrase && exportPassphrase === exportPassphraseConfirm && Array.from(exportPassphrase).length >= 12 ? "ready" : ""}><i />{exportPassphrase && exportPassphrase === exportPassphraseConfirm && Array.from(exportPassphrase).length >= 12 ? "两次输入一致；口令不会保存" : `${Array.from(exportPassphrase).length}/12 字符 · 遗忘后无法找回`}</p>
            </div>
          )}
          <div className="vault-current-strip">
            <span><strong>{currentSummary.objectCount}</strong>结构对象</span>
            <span><strong>{currentSummary.transcriptCount}</strong>字幕源</span>
            <span><strong>{currentSummary.frameCount}</strong>画面帧</span>
            <span><strong>{formatBytes(currentSummary.frameBytes)}</strong>画面</span>
          </div>
          <button onClick={exportBackup} disabled={Boolean(busy)}>{busy === "export" ? exportProtection === "encrypted" ? "正在加密封卷…" : "正在封装…" : exportProtection === "encrypted" ? "生成加密迁移卷" : "生成标准迁移卷"}<span>{exportProtection === "encrypted" ? "AES-256" : "↓ JSON"}</span></button>
          <small>不包含 Base URL、模型名称、API 密钥或本地视频原文件。</small>
        </article>

        <article className="vault-action-card restore">
          <header><span>IN / 02</span><i>↙</i></header>
          <h2>从迁移卷恢复</h2>
          <p>先读取文件并展示增删改；只有你再次确认，才会整体替换当前工作台。</p>
          <button className="vault-file-button" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>{busy === "read" ? "正在核对…" : "选择迁移卷"}<span>JSON ≤ 132MB</span></button>
          <input ref={fileInput} type="file" accept="application/json,.json" onChange={readBackup} hidden />
          <div className="vault-safety-row"><span><i>✓</i>解锁加密卷</span><span><i>✓</i>校验损坏</span><span><i>✓</i>预览差异</span><span><i>✓</i>本次可撤销</span></div>
          <small>恢复是完整替换，不会把两个工作台静默混合。</small>
        </article>
      </div>

      {lockedBackup && (
        <section className="vault-locked-preview">
          <div className="vault-lock-dial" aria-hidden="true"><i /><span>LOCKED</span><b>⌾</b></div>
          <div className="vault-locked-copy"><span>ENCRYPTED ARCHIVE / 尚未解锁</span><h2>{lockedBackup.fileName}</h2><p>{formatBytes(lockedBackup.fileBytes)} · 封卷于 {formatDate(lockedBackup.envelope.createdAt)}</p><small>AES-256-GCM · PBKDF2-SHA-256 × {BACKUP_KDF_ITERATIONS.toLocaleString("en-US")} · 口令只进入当前页面内存</small></div>
          <div className="vault-unlock-form">
            <label htmlFor="vault-unlock-passphrase">解锁口令</label>
            <input id="vault-unlock-passphrase" type="password" autoComplete="off" value={unlockPassphrase} onChange={(event) => setUnlockPassphrase(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void unlockBackup(); }} placeholder="输入封卷时使用的口令" autoFocus />
            <div><button onClick={discardLockedBackup} disabled={Boolean(busy)}>丢弃</button><button onClick={unlockBackup} disabled={Boolean(busy)}>{busy === "decrypt" ? "正在解锁…" : "解锁并预检"}<span>→</span></button></div>
          </div>
        </section>
      )}

      <section className="vault-inventory">
        <header><div><span>CURRENT INVENTORY</span><h2>当前设备清单</h2></div><strong>WORKSPACE v{currentSummary.workspaceVersion}</strong></header>
        <div className="vault-module-tape">
          {visibleModules.length ? visibleModules.map(([key, count]) => <span key={key}><small>{summaryLabels[key] || key}</small><strong>{count}</strong></span>) : <p>还没有结构对象；空工作台也可以导出。</p>}
        </div>
      </section>

      <SyncStudio state={state} sources={localSources} onStageBackup={stageSyncBackup} />

      {lastExport && !pending && !lockedBackup && (
        <article className={`vault-receipt export-receipt ${lastExport.protected ? "protected" : ""}`}>
          <div><span>{lastExport.protected ? "ENCRYPTED EXPORT RECEIPT" : "EXPORT RECEIPT"}</span><strong>{formatDate(lastExport.exportedAt)}</strong><small>{formatBytes(lastExport.bytes)} · {lastExport.summary.objectCount} 个对象 · {lastExport.protected ? "AES-256-GCM" : "未加密"}</small></div>
          <code>{lastExport.checksum.slice(0, 16)}…{lastExport.checksum.slice(-8)}</code>
          <p>{lastExport.protected ? "内层校验值已被加密；遗忘保护口令后，工作台也无法代你找回。" : "校验值用于发现文件损坏或改动，不代表文件来源可信。"}</p>
        </article>
      )}

      {pending && (
        <section className={`vault-preview ${pending.sync ? "sync-preview" : ""}`}>
          <header>
            <div><span>{pending.sync ? "SYNC PROOF / 同步密文已验证 · 未写入" : pending.protected ? "UNLOCKED PROOF / 加密层已验证 · 未写入" : "RESTORE PROOF / 未写入"}</span><h2>{pending.fileName}</h2><p>{formatBytes(pending.fileBytes)} · 导出于 {formatDate(pending.envelope.exportedAt)} · 工作台 v{pending.envelope.workspaceVersion}</p></div>
            <code>{pending.envelope.checksum.slice(0, 14)}…</code>
          </header>
          <section className={`compatibility-proof ${pending.compatibility.status}`}>
            <header><div><span>COMPATIBILITY CHECK / 写入前兼容证明</span><h3>工作台 v{pending.compatibility.sourceVersion} <i>→</i> v{pending.compatibility.targetVersion}</h3></div><strong>{pending.compatibility.status === "attention" ? "需要注意" : pending.compatibility.migrationRequired ? "将在内存迁移" : "可直接写入"}</strong></header>
            <div className="compatibility-summary"><span><small>规范化对象</small><strong>{pending.compatibility.normalizedObjects}</strong></span><span><small>忽略对象</small><strong>{pending.compatibility.droppedObjects}</strong></span><span><small>修复引用</small><strong>{pending.compatibility.repairedReferences}</strong></span><p>{pending.compatibility.migrationRequired ? "源文件保持不变；确认写入时使用已经迁移到当前版本的内存结果。" : pending.compatibility.warningCount ? "下列不兼容内容不会进入写入结果；源文件不会被改写。" : "格式、对象数量与引用边界已通过当前版本检查。"}</p></div>
            {pending.compatibility.changes.length > 0 && <div className="compatibility-changes">{pending.compatibility.changes.map((change) => <div key={change.key} className={change.severity}><strong>{change.label}</strong><span>{change.before} <i>→</i> {change.after}</span><p>{change.dropped > 0 ? `忽略 ${change.dropped}` : ""}{change.dropped > 0 && change.normalized > 0 ? " · " : ""}{change.normalized > 0 ? `规范化 ${change.normalized}` : ""}</p></div>)}</div>}
          </section>
          {pending.sync && (
            <div className={`sync-preview-chain ${pending.sync.relation}`}>
              <span>{pending.sync.relation === "initial" ? "首次版本" : pending.sync.relation === "forward" ? "顺序后继" : "版本已分叉"}</span>
              <code>{pending.sync.parentRevisionId ? `${pending.sync.parentRevisionId.slice(0, 18)}…` : "ROOT"} <i>→</i> {pending.sync.revisionId.slice(0, 18)}…</code>
              <p>来自 <strong>{pending.sync.authorName}</strong>{pending.sync.relation === "diverged" ? pending.merge ? "；共同父版本已找到，可审阅三方合并。" : "；缺少共同父版本，只能明确选择整体迁入。" : "；确认恢复后才更新本机版本头。"}</p>
            </div>
          )}
          {pending.merge && (
            <section className="merge-resolution">
              <header>
                <div><span>THREE-WAY MERGE / 共同父版本 → 两台设备</span><h3>不同字段自动拼合，同一字段分歧才需要明确选择。</h3></div>
                <div role="radiogroup" aria-label="分叉处理方式"><button role="radio" aria-checked={mergeMode === "merge"} className={mergeMode === "merge" ? "active" : ""} onClick={() => { setMergeMode("merge"); setRestoreArmed(false); }}>字段级合并</button><button role="radio" aria-checked={mergeMode === "replace"} className={mergeMode === "replace" ? "active danger" : ""} onClick={() => { setMergeMode("replace"); setRestoreArmed(false); }}>整体迁入</button></div>
              </header>
              {mergeMode === "merge" ? (
                <>
                  <div className="merge-totals"><span><small>自动保留本机</small><strong>{pending.merge.autoLocalCount}</strong></span><span><small>自动接入迁入</small><strong>{pending.merge.autoIncomingCount}</strong></span><span><small>字段自动拼合</small><strong>{pending.merge.autoFieldMergedCount}</strong></span><span className={unresolvedMergeCount ? "warning" : "ready"}><small>尚待选择</small><strong>{unresolvedMergeCount}</strong></span></div>
                  <div className="merge-category-tape">{pending.merge.rows.map((row) => <span key={row.key}><strong>{row.label}</strong><small>{row.changed} 处变化{row.conflicts ? ` · ${row.conflicts} 冲突` : " · 自动"}</small></span>)}</div>
                  {pending.merge.conflictCount > 0 ? (
                    <div className="merge-conflict-list">
                      {pending.merge.entries.filter((entry) => entry.kind === "conflict").map((entry) => {
                        if (entry.resolution === "fields") return (
                          <article key={entry.key} className="field-resolution">
                            <header><span>{entry.categoryLabel} · 字段冲突</span><strong>{entry.title}</strong><code>{entry.objectId.slice(0, 24)}</code></header>
                            <div className="merge-field-conflicts">{entry.fieldConflicts.map((field) => {
                              const selected = mergeChoices[field.key];
                              return <section key={field.key}><header><strong>{field.label}</strong><small>{selected ? "已选择" : "等待明确选择"}</small></header><div><button className={selected === "local" ? "active" : ""} onClick={() => chooseMergeSide(field.key, "local")} aria-pressed={selected === "local"}><span>保留本机字段</span><strong>{field.localState}</strong><p>{describeMergeValue(field.localValue)}</p></button><button className={selected === "incoming" ? "active incoming" : ""} onClick={() => chooseMergeSide(field.key, "incoming")} aria-pressed={selected === "incoming"}><span>采用迁入字段</span><strong>{field.incomingState}</strong><p>{describeMergeValue(field.incomingValue)}</p></button></div></section>;
                            })}</div>
                          </article>
                        );
                        const selected = mergeChoices[entry.key];
                        return <article key={entry.key}><header><span>{entry.categoryLabel} · 对象冲突</span><strong>{entry.title}</strong><code>{entry.objectId.slice(0, 24)}</code></header><div className="merge-object-options"><button className={selected === "local" ? "active" : ""} onClick={() => chooseMergeSide(entry.key, "local")} aria-pressed={selected === "local"}><span>保留本机对象</span><strong>{entry.localState}</strong><p>{describeMergeValue(entry.localValue)}</p></button><button className={selected === "incoming" ? "active incoming" : ""} onClick={() => chooseMergeSide(entry.key, "incoming")} aria-pressed={selected === "incoming"}><span>采用迁入对象</span><strong>{entry.incomingState}</strong><p>{describeMergeValue(entry.incomingValue)}</p></button></div></article>;
                      })}
                    </div>
                  ) : <p className="merge-no-conflict"><i>✓</i><span><strong>没有同字段或删除冲突。</strong>两台设备的独立对象与字段变化已经按稳定 ID 组成合并结果。</span></p>}
                </>
              ) : <p className="merge-replace-warning"><i>!</i><span><strong>整体迁入会忽略自动合并和上方选择。</strong>当前设备独有的对象会按下方差异被移除；仍需再次点击确认。</span></p>}
            </section>
          )}
          <div className="vault-delta-total">
            <span className="added"><small>新增</small><strong>+{previewDiff?.added || 0}</strong></span>
            <span className="changed"><small>改写</small><strong>{previewDiff?.changed || 0}</strong></span>
            <span className="removed"><small>移除</small><strong>−{previewDiff?.removed || 0}</strong></span>
            <span><small>保持</small><strong>{previewDiff?.unchanged || 0}</strong></span>
          </div>
          <div className="vault-diff-table" role="table" aria-label="恢复差异">
            <div className="vault-diff-head" role="row"><span>模块</span><span>当前 → {pending.merge && mergeMode === "merge" ? "合并" : "迁入"}</span><span>变化</span></div>
            {previewDiff?.rows.map((row) => (
              <div role="row" key={row.key} className={row.added || row.removed || row.changed ? "has-delta" : ""}>
                <strong>{row.label}</strong>
                <span>{row.current} <i>→</i> {row.incoming}</span>
                <span>{row.added > 0 && <b className="added">+{row.added}</b>}{row.changed > 0 && <b className="changed">~{row.changed}</b>}{row.removed > 0 && <b className="removed">−{row.removed}</b>}{!row.added && !row.changed && !row.removed && <small>不变</small>}</span>
              </div>
            ))}
          </div>
          <div className="vault-media-proof">
            <div><span>本机资料库</span><strong>字幕 {currentSummary.transcriptCount} → {previewSummary?.transcriptCount || 0}</strong><strong>画面 {currentSummary.frameCount} → {previewSummary?.frameCount || 0}</strong></div>
            <p><i>{pending.merge && mergeMode === "merge" ? "✓" : "!"}</i><span><strong>{pending.merge && mergeMode === "merge" ? "写入审阅后的合并结果。" : "这是整体替换。"}</strong>当前工作台和资料库会先留作内存撤销快照；页面刷新后撤销入口消失。</span></p>
          </div>
          <footer>
            <button onClick={discardPreview} disabled={Boolean(busy)}>丢弃预检</button>
            <button className={restoreArmed ? "armed" : ""} onClick={restoreBackup} disabled={Boolean(busy) || Boolean(pending.merge && mergeMode === "merge" && unresolvedMergeCount)}>{busy === "restore" ? pending.merge && mergeMode === "merge" ? "正在写入合并…" : "正在恢复…" : pending.merge && mergeMode === "merge" && unresolvedMergeCount ? `先选择 ${unresolvedMergeCount} 个冲突` : restoreArmed ? pending.merge && mergeMode === "merge" ? "再次点击，确认写入合并" : "再次点击，确认整体替换" : pending.merge && mergeMode === "merge" ? "准备写入合并" : "准备恢复"}<span>{restoreArmed ? "!" : "→"}</span></button>
          </footer>
        </section>
      )}

      {restoreReceipt && (
        <article className="vault-receipt restore-receipt">
          <div className="receipt-stamp">RESTORED<small>{formatDate(restoreReceipt.restoredAt)}</small></div>
          <div><span>{restoreReceipt.merged ? "字段合并回执" : "恢复回执"}</span><strong>{restoreReceipt.fileName}</strong><small>源卷校验 {restoreReceipt.checksum.slice(0, 12)}… · {restoreReceipt.merged ? "三方结果" : "迁移卷"}已写入当前浏览器{restoreReceipt.mergeDecision ? `；${restoreReceipt.mergeDecision.totals.conflictDecisions} 个明确选择已记入无字段内容回执` : ""}</small></div>
          <div className="restore-receipt-actions">{restoreReceipt.mergeDecision && <button onClick={() => downloadMergeDecision(restoreReceipt.mergeDecision!)} disabled={Boolean(busy)}>下载决策回执<span>↓</span></button>}{undo && <button onClick={undoRestore} disabled={Boolean(busy)}>{busy === "undo" ? "正在撤回…" : "撤回整次恢复"}<span>↶</span></button>}</div>
        </article>
      )}
    </section>
  );
}
