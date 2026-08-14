"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
  parseBackupText,
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
};

type ExportReceipt = {
  exportedAt: string;
  checksum: string;
  bytes: number;
  summary: BackupSummary;
  protected: boolean;
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
  const [restoreReceipt, setRestoreReceipt] = useState<{ fileName: string; restoredAt: string; checksum: string } | null>(null);
  const [exportProtection, setExportProtection] = useState<"plain" | "encrypted">("encrypted");
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState("");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");

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

  function stagePreview(raw: string, fileName: string, fileBytes: number, protectedBackup: boolean) {
    return parseBackupText(raw).then((parsed) => {
      const diff = compareBackupStates(state, parsed.workspace);
      setPending({
        fileName,
        fileBytes,
        envelope: parsed.envelope,
        workspace: parsed.workspace,
        sources: parsed.sources,
        summary: parsed.summary,
        diff,
        protected: protectedBackup,
      });
    });
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
    if (!restoreArmed) {
      setRestoreArmed(true);
      setMessage("已进入确认状态：再次点击会用迁移卷整体替换当前本地工作台。 ");
      return;
    }
    setBusy("restore");
    setMessage("正在建立恢复前快照，并写入迁移卷…");
    let previousSources: BackupSources | null = null;
    try {
      previousSources = await exportSourceArchive();
      const previousWorkspace = state;
      const replaced = await replaceSourceArchive(pending.sources);
      if (!replaced) throw new Error("当前浏览器不支持本地媒体库恢复");
      try {
        onRestore(pending.workspace);
      } catch (error) {
        await replaceSourceArchive(previousSources);
        throw error;
      }
      const restoredAt = new Date().toISOString();
      setUndo({ workspace: previousWorkspace, sources: previousSources, restoredAt, fileName: pending.fileName });
      setLocalSources(pending.sources);
      setRestoreReceipt({ fileName: pending.fileName, restoredAt, checksum: pending.envelope.checksum });
      setPending(null);
      setRestoreArmed(false);
      setMessage("恢复完成。关闭或刷新页面前，你仍可一步撤回到恢复前状态。 ");
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
      setLocalSources(undo.sources);
      setUndo(null);
      setRestoreReceipt(null);
      setMessage("已撤回恢复，工作台回到导入之前的完整状态。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤回失败，当前状态保持不变");
    } finally {
      setBusy("");
    }
  }

  function discardPreview() {
    setPending(null);
    setRestoreArmed(false);
    setMessage("已丢弃预检结果，没有写入任何数据。 ");
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

      {lastExport && !pending && !lockedBackup && (
        <article className={`vault-receipt export-receipt ${lastExport.protected ? "protected" : ""}`}>
          <div><span>{lastExport.protected ? "ENCRYPTED EXPORT RECEIPT" : "EXPORT RECEIPT"}</span><strong>{formatDate(lastExport.exportedAt)}</strong><small>{formatBytes(lastExport.bytes)} · {lastExport.summary.objectCount} 个对象 · {lastExport.protected ? "AES-256-GCM" : "未加密"}</small></div>
          <code>{lastExport.checksum.slice(0, 16)}…{lastExport.checksum.slice(-8)}</code>
          <p>{lastExport.protected ? "内层校验值已被加密；遗忘保护口令后，工作台也无法代你找回。" : "校验值用于发现文件损坏或改动，不代表文件来源可信。"}</p>
        </article>
      )}

      {pending && (
        <section className="vault-preview">
          <header>
            <div><span>{pending.protected ? "UNLOCKED PROOF / 加密层已验证 · 未写入" : "RESTORE PROOF / 未写入"}</span><h2>{pending.fileName}</h2><p>{formatBytes(pending.fileBytes)} · 导出于 {formatDate(pending.envelope.exportedAt)} · 工作台 v{pending.envelope.workspaceVersion}</p></div>
            <code>{pending.envelope.checksum.slice(0, 14)}…</code>
          </header>
          <div className="vault-delta-total">
            <span className="added"><small>新增</small><strong>+{pending.diff.added}</strong></span>
            <span className="changed"><small>改写</small><strong>{pending.diff.changed}</strong></span>
            <span className="removed"><small>移除</small><strong>−{pending.diff.removed}</strong></span>
            <span><small>保持</small><strong>{pending.diff.unchanged}</strong></span>
          </div>
          <div className="vault-diff-table" role="table" aria-label="恢复差异">
            <div className="vault-diff-head" role="row"><span>模块</span><span>当前 → 迁入</span><span>变化</span></div>
            {pending.diff.rows.map((row) => (
              <div role="row" key={row.key} className={row.added || row.removed || row.changed ? "has-delta" : ""}>
                <strong>{row.label}</strong>
                <span>{row.current} <i>→</i> {row.incoming}</span>
                <span>{row.added > 0 && <b className="added">+{row.added}</b>}{row.changed > 0 && <b className="changed">~{row.changed}</b>}{row.removed > 0 && <b className="removed">−{row.removed}</b>}{!row.added && !row.changed && !row.removed && <small>不变</small>}</span>
              </div>
            ))}
          </div>
          <div className="vault-media-proof">
            <div><span>本机资料库</span><strong>字幕 {currentSummary.transcriptCount} → {pending.summary.transcriptCount}</strong><strong>画面 {currentSummary.frameCount} → {pending.summary.frameCount}</strong></div>
            <p><i>!</i><span><strong>这是整体替换。</strong>当前工作台和资料库会先留作内存撤销快照；页面刷新后撤销入口消失。</span></p>
          </div>
          <footer>
            <button onClick={discardPreview} disabled={Boolean(busy)}>丢弃预检</button>
            <button className={restoreArmed ? "armed" : ""} onClick={restoreBackup} disabled={Boolean(busy)}>{busy === "restore" ? "正在恢复…" : restoreArmed ? "再次点击，确认整体替换" : "准备恢复"}<span>{restoreArmed ? "!" : "→"}</span></button>
          </footer>
        </section>
      )}

      {restoreReceipt && (
        <article className="vault-receipt restore-receipt">
          <div className="receipt-stamp">RESTORED<small>{formatDate(restoreReceipt.restoredAt)}</small></div>
          <div><span>恢复回执</span><strong>{restoreReceipt.fileName}</strong><small>校验 {restoreReceipt.checksum.slice(0, 12)}… · 已完整写入当前浏览器</small></div>
          {undo && <button onClick={undoRestore} disabled={Boolean(busy)}>{busy === "undo" ? "正在撤回…" : "撤回整次恢复"}<span>↶</span></button>}
        </article>
      )}
    </section>
  );
}
