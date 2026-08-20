"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_EXTERNAL_MEDIA_DUPLICATE_AUDIT_BYTES,
  compareExternalMediaDuplicateAuditToIndex,
  createExternalMediaDuplicateAudit,
  inspectExternalMediaDuplicateAuditText,
  serializeExternalMediaDuplicateAudit,
} from "../features/external-media-duplicate-audit.mjs";
import type {
  ExternalMediaDuplicateAuditComparison,
  ExternalMediaDuplicateAuditInspection,
} from "../features/external-media-duplicate-audit.mjs";
import {
  EXTERNAL_MEDIA_INDEX_CHANGED_EVENT,
  calculateExternalMediaFullHash,
  createExternalMediaDuplicateReport,
  listExternalMediaInfo,
  openExternalMediaFile,
  relocateExternalMediaHandles,
  removeExternalMediaHandles,
  scanExternalMediaIndex,
  supportsExternalMediaHandles,
} from "../features/external-media-store.mjs";
import type { ExternalMediaHealth, ExternalMediaHealthStatus, ExternalMediaInfo } from "../features/external-media-store.mjs";
import type { VideoRecord } from "../features/workbench-core.mjs";

type ExternalMediaLibraryProps = { videos: VideoRecord[] };
type LibraryRow = ExternalMediaHealth | (ExternalMediaInfo & {
  status: "unchecked";
  permission: "unknown";
  checkedAt: string;
  detail: string;
});
type FilePickerGlobal = typeof globalThis & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
};
type HashQueueItem = {
  sourceKey: string;
  name: string;
  status: "queued" | "hashing" | "done" | "failed";
  progress: number;
  detail: string;
};
type DuplicateAuditState = {
  fileName: string;
  inspection: ExternalMediaDuplicateAuditInspection;
  comparison: ExternalMediaDuplicateAuditComparison;
};

const mediaPickerOptions = {
  multiple: true,
  types: [{
    description: "需要重新定位的音频或视频",
    accept: {
      "video/*": [".mp4", ".mov", ".mkv", ".webm"],
      "audio/*": [".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"],
    },
  }],
};

const statusLabels: Record<ExternalMediaHealthStatus | "unchecked", string> = {
  ready: "可读取",
  permission: "待授权",
  changed: "内容变化",
  missing: "句柄失效",
  orphaned: "来源已删除",
  unchecked: "等待扫描",
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function uncheckedRow(info: ExternalMediaInfo, validSources: Set<string>): LibraryRow {
  if (!validSources.has(info.sourceKey)) {
    return { ...info, status: "orphaned", permission: "unknown", checkedAt: "", detail: "对应的本地视频记录已经不存在" };
  }
  return { ...info, status: "unchecked", permission: "unknown", checkedAt: "", detail: "点击扫描后核对权限、元数据与采样指纹" };
}

export function ExternalMediaLibrary({ videos }: ExternalMediaLibraryProps) {
  const duplicateAuditInput = useRef<HTMLInputElement>(null);
  const localVideos = useMemo(() => videos.filter((video) => video.platform === "local"), [videos]);
  const videoBySource = useMemo(() => new Map(localVideos.map((video) => [video.url, video])), [localVideos]);
  const validSourceKeys = useMemo(() => new Set(localVideos.map((video) => video.url)), [localVideos]);
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "scan" | "permission" | "relocate" | "hash" | "remove" | "audit-export" | "audit-read">("");
  const [message, setMessage] = useState("索引只记录浏览器文件句柄和指纹；维护动作不会移动、改名或删除磁盘原文件。 ");
  const [progress, setProgress] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);
  const [hashQueue, setHashQueue] = useState<HashQueueItem[]>([]);
  const [hashQueueState, setHashQueueState] = useState<"idle" | "running" | "pausing" | "paused" | "complete">("idle");
  const [duplicateAudit, setDuplicateAudit] = useState<DuplicateAuditState | null>(null);
  const pauseRequested = useRef(false);
  const resumeHashing = useRef<(() => void) | null>(null);
  const hashAbortController = useRef<AbortController | null>(null);

  const loadIndex = useCallback(async () => {
    const infos = await listExternalMediaInfo();
    setRows(infos.map((info) => uncheckedRow(info, validSourceKeys)));
    setSelected((current) => new Set([...current].filter((sourceKey) => infos.some((info) => info.sourceKey === sourceKey))));
  }, [validSourceKeys]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active) return;
      void loadIndex().catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "无法读取外部媒体索引");
      });
    };
    const initialRefresh = globalThis.setTimeout(refresh, 0);
    globalThis.addEventListener(EXTERNAL_MEDIA_INDEX_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      globalThis.clearTimeout(initialRefresh);
      globalThis.removeEventListener(EXTERNAL_MEDIA_INDEX_CHANGED_EVENT, refresh);
    };
  }, [loadIndex]);

  useEffect(() => () => {
    hashAbortController.current?.abort();
    resumeHashing.current?.();
  }, []);

  const totals = useMemo(() => ({
    ready: rows.filter((row) => row.status === "ready").length,
    attention: rows.filter((row) => ["permission", "changed", "missing", "orphaned"].includes(row.status)).length,
    full: rows.filter((row) => Boolean(row.fullHash)).length,
  }), [rows]);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.sourceKey)), [rows, selected]);
  const duplicateReport = useMemo(() => createExternalMediaDuplicateReport(rows), [rows]);
  const auditedDuplicateReceipt = duplicateAudit?.inspection.receipt;

  useEffect(() => {
    if (!auditedDuplicateReceipt) return;
    let active = true;
    compareExternalMediaDuplicateAuditToIndex(auditedDuplicateReceipt, rows).then((comparison) => {
      if (active) setDuplicateAudit((current) => current ? { ...current, comparison } : null);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [auditedDuplicateReceipt, rows]);

  function toggleSelection(sourceKey: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sourceKey)) next.delete(sourceKey);
      else next.add(sourceKey);
      return next;
    });
    setRemoveArmed(false);
  }

  function selectAttention() {
    setSelected(new Set(rows.filter((row) => row.status !== "ready" && row.status !== "unchecked").map((row) => row.sourceKey)));
    setRemoveArmed(false);
  }

  async function scanIndex() {
    setBusy("scan");
    setProgress("");
    setRemoveArmed(false);
    try {
      const health = await scanExternalMediaIndex([...validSourceKeys]);
      setRows(health);
      const attention = health.filter((row) => row.status !== "ready").length;
      setMessage(attention ? `扫描完成：${health.length - attention} 条可读取，${attention} 条需要处理。` : `扫描完成：${health.length} 条索引均可读取。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法扫描外部媒体索引");
    } finally {
      setBusy("");
    }
  }

  async function authorizeAndVerify(sourceKey: string) {
    setBusy("permission");
    setRemoveArmed(false);
    try {
      await openExternalMediaFile(sourceKey);
      setRows(await scanExternalMediaIndex([...validSourceKeys]));
      setMessage("读取权限已确认，名称、元数据与采样指纹一致。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法核对这条外部媒体索引");
    } finally {
      setBusy("");
    }
  }

  async function relocateSelected() {
    if (!selected.size) {
      setMessage("先选择需要重新定位的索引，再选择一个或多个候选原文件。 ");
      return;
    }
    if (!supportsExternalMediaHandles()) {
      setMessage("当前浏览器不支持批量文件句柄选择。 ");
      return;
    }
    try {
      setRemoveArmed(false);
      const handles = await (globalThis as FilePickerGlobal).showOpenFilePicker?.(mediaPickerOptions) || [];
      if (!handles.length) return;
      setBusy("relocate");
      setProgress("正在计算候选文件的采样证据…");
      const result = await relocateExternalMediaHandles([...selected], handles, (value) => {
        const percent = Math.round((value.processedBytes / value.totalBytes) * 100);
        setProgress(`完整核对 ${value.fileIndex}/${value.fileCount} · ${value.fileName} · ${percent}%`);
      });
      const health = await scanExternalMediaIndex([...validSourceKeys]);
      setRows(health);
      setSelected(new Set(result.unresolvedSourceKeys));
      setMessage(result.matched.length
        ? `已重新定位 ${result.matched.length} 条索引${result.unresolvedSourceKeys.length ? `；${result.unresolvedSourceKeys.length} 条因没有唯一匹配而保持原状` : ""}${result.unmatchedFiles.length ? `；${result.unmatchedFiles.length} 个候选文件未使用` : ""}。`
        : "没有找到唯一匹配；索引和候选文件均未改动。可先为原索引计算完整哈希，再处理重命名文件。 ");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "无法批量重新定位外部原文件");
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  async function hashSelected() {
    if (!selected.size) {
      setMessage("先选择需要加入完整 SHA-256 队列的可读取索引。 ");
      return;
    }
    const hashableRows = selectedRows.filter((row) => !row.fullHash && !["changed", "missing", "orphaned"].includes(row.status));
    const alreadyHashed = selectedRows.filter((row) => Boolean(row.fullHash)).length;
    const unsafe = selectedRows.length - hashableRows.length - alreadyHashed;
    if (!hashableRows.length) {
      setMessage(alreadyHashed ? "所选可读取索引都已经保存完整 SHA-256。 " : "所选索引都无法安全核对；请先重新定位内容变化或失效项，并移除孤立索引。 ");
      return;
    }
    const controller = new AbortController();
    hashAbortController.current = controller;
    pauseRequested.current = false;
    setHashQueue(hashableRows.map((row) => ({ sourceKey: row.sourceKey, name: row.name, status: "queued", progress: 0, detail: "等待分块读取" })));
    setHashQueueState("running");
    setBusy("hash");
    setRemoveArmed(false);
    const waitIfPaused = async () => {
      if (!pauseRequested.current) return;
      setHashQueueState("paused");
      setProgress("完整哈希队列已在分块边界暂停；当前页面仍保留内存哈希状态");
      await new Promise<void>((resolve) => { resumeHashing.current = resolve; });
      resumeHashing.current = null;
    };
    try {
      let completed = 0;
      let failed = 0;
      const failedSourceKeys: string[] = [];
      for (let index = 0; index < hashableRows.length; index += 1) {
        const row = hashableRows[index];
        await waitIfPaused();
        setHashQueue((current) => current.map((item) => item.sourceKey === row.sourceKey ? { ...item, status: "hashing", detail: `正在读取第 ${index + 1}/${hashableRows.length} 个文件` } : item));
        try {
          await calculateExternalMediaFullHash(row.sourceKey, (processedBytes, totalBytes) => {
            const percent = Math.round((processedBytes / totalBytes) * 100);
            setProgress(`后台哈希 ${index + 1}/${hashableRows.length} · ${row.name} · ${percent}%`);
            setHashQueue((current) => current.map((item) => item.sourceKey === row.sourceKey ? { ...item, progress: percent, detail: `${formatBytes(processedBytes)} / ${formatBytes(totalBytes)}` } : item));
          }, { signal: controller.signal, waitIfPaused });
          completed += 1;
          setHashQueue((current) => current.map((item) => item.sourceKey === row.sourceKey ? { ...item, status: "done", progress: 100, detail: "完整 SHA-256 已保存" } : item));
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          failed += 1;
          failedSourceKeys.push(row.sourceKey);
          setHashQueue((current) => current.map((item) => item.sourceKey === row.sourceKey ? { ...item, status: "failed", detail: error instanceof Error ? error.message : "无法读取这份文件" } : item));
        }
      }
      setHashQueueState("complete");
      setRows(await scanExternalMediaIndex([...validSourceKeys]));
      setSelected(new Set(failedSourceKeys));
      setMessage(`后台队列完成：${completed} 条完整哈希已保存${failed ? `，${failed} 条失败并保留在队列回执` : ""}${unsafe ? `；${unsafe} 条不可核对索引未入队` : ""}${alreadyHashed ? `；${alreadyHashed} 条已有完整哈希未重复读取` : ""}。`);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setHashQueueState("complete");
        setMessage(error instanceof Error ? error.message : "无法计算完整媒体哈希");
      }
    } finally {
      pauseRequested.current = false;
      resumeHashing.current?.();
      resumeHashing.current = null;
      hashAbortController.current = null;
      setBusy("");
      setProgress("");
    }
  }

  function pauseHashQueue() {
    if (hashQueueState !== "running") return;
    pauseRequested.current = true;
    setHashQueueState("pausing");
    setMessage("已请求暂停；当前 4 MiB 分块完成后停止继续读取。 ");
  }

  function resumeHashQueue() {
    if (hashQueueState !== "paused" && hashQueueState !== "pausing") return;
    pauseRequested.current = false;
    setHashQueueState("running");
    setMessage("完整哈希队列继续运行。 ");
    resumeHashing.current?.();
    resumeHashing.current = null;
  }

  async function exportDuplicateAudit() {
    setBusy("audit-export");
    try {
      const receipt = await createExternalMediaDuplicateAudit(rows);
      downloadText(serializeExternalMediaDuplicateAudit(receipt), `evolve-media-duplicate-audit-${receipt.createdAt.replace(/[-:]/g, "").slice(0, 13)}.json`);
      setMessage("无内容重复审计摘要已生成；文件名、路径、来源 ID、采样指纹和原始完整哈希均未导出。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成外部媒体重复审计摘要");
    } finally {
      setBusy("");
    }
  }

  async function readDuplicateAudit(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("audit-read");
    try {
      if (file.size > MAX_EXTERNAL_MEDIA_DUPLICATE_AUDIT_BYTES) throw new Error("外部媒体重复审计摘要超过 64 KiB 上限");
      const inspection = await inspectExternalMediaDuplicateAuditText(await file.text());
      const comparison = await compareExternalMediaDuplicateAuditToIndex(inspection.receipt, rows);
      setDuplicateAudit({ fileName: file.name, inspection, comparison });
      setMessage(comparison.matches
        ? "审计摘要的 SHA-256 封签有效，并与本机重复报告逐项一致；没有读取或覆盖任何媒体索引。 "
        : `审计摘要封签有效，但与本机报告不同：${comparison.reasons.join("；")}。`);
    } catch (error) {
      setDuplicateAudit(null);
      setMessage(error instanceof Error ? error.message : "无法核对外部媒体重复审计摘要");
    } finally {
      setBusy("");
    }
  }

  async function removeSelected() {
    if (!selected.size) return;
    if (!removeArmed) {
      setRemoveArmed(true);
      setMessage(`再次点击将移除 ${selected.size} 条浏览器索引；磁盘上的原文件不会被删除。`);
      return;
    }
    setBusy("remove");
    try {
      const removed = await removeExternalMediaHandles([...selected]);
      setSelected(new Set());
      setRemoveArmed(false);
      await loadIndex();
      setMessage(`已移除 ${removed} 条外部媒体索引；没有读取或删除任何原文件。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法移除外部媒体索引");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="external-media-library">
      <header>
        <div><p className="eyebrow">本地原文件维护</p><h2>句柄会失效，证据链要能重新接上。</h2><span>扫描不会弹出批量授权；只有“授权并复查”、完整哈希和重新定位会在你的点击下读取文件。</span></div>
        <div className="media-health-totals"><span><small>索引</small><strong>{rows.length}</strong></span><span className="ready"><small>可读取</small><strong>{totals.ready}</strong></span><span className={totals.attention ? "attention" : "ready"}><small>待处理</small><strong>{totals.attention}</strong></span><span><small>完整哈希</small><strong>{totals.full}</strong></span></div>
      </header>

      <div className="media-maintenance-toolbar">
        <div><button onClick={() => void scanIndex()} disabled={Boolean(busy)}>{busy === "scan" ? "正在扫描…" : "扫描全部索引"}</button><button onClick={selectAttention} disabled={Boolean(busy) || !totals.attention}>选择待处理</button><button onClick={() => { setSelected(new Set()); setRemoveArmed(false); }} disabled={Boolean(busy) || !selected.size}>清除选择</button></div>
        <div><button onClick={() => void relocateSelected()} disabled={Boolean(busy) || !selected.size}>{busy === "relocate" ? "正在匹配…" : "重新定位所选"}</button><button onClick={() => void hashSelected()} disabled={Boolean(busy) || !selected.size}>{busy === "hash" ? "队列运行中…" : "加入完整哈希队列"}</button><button className={removeArmed ? "armed" : "danger"} onClick={() => void removeSelected()} disabled={Boolean(busy) || !selected.size}>{busy === "remove" ? "正在移除…" : removeArmed ? "再次点击，确认移除索引" : "移除所选索引"}</button></div>
      </div>

      <div className="media-maintenance-status" role="status"><i className={busy && hashQueueState !== "paused" ? "working" : ""} /><span>{progress || message}</span><code>{hashQueueState === "running" || hashQueueState === "pausing" || hashQueueState === "paused" ? hashQueueState.toUpperCase() : `${selected.size} SELECTED`}</code></div>

      {hashQueue.length > 0 && (
        <section className={`media-hash-queue ${hashQueueState}`}>
          <header><div><span>HASH QUEUE / 当前页面</span><h3>分块完整哈希队列</h3></div><strong>{hashQueue.filter((item) => item.status === "done").length}/{hashQueue.length} 完成</strong><div>{hashQueueState === "running" ? <button onClick={pauseHashQueue}>在分块边界暂停</button> : hashQueueState === "paused" || hashQueueState === "pausing" ? <button onClick={resumeHashQueue}>{hashQueueState === "pausing" ? "取消暂停请求" : "继续队列"}</button> : <button onClick={() => { setHashQueue([]); setHashQueueState("idle"); }}>清除队列回执</button>}</div></header>
          <div>{hashQueue.map((item, index) => <article key={item.sourceKey} className={item.status}><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{item.name}</strong><small>{item.detail}</small></span><div><b style={{ width: `${item.progress}%` }} /></div><code>{item.status === "queued" ? "WAIT" : item.status === "hashing" ? `${item.progress}%` : item.status === "done" ? "SHA ✓" : "FAILED"}</code></article>)}</div>
          <footer>暂停只保留当前页面内存中的 SHA-256 中间状态；刷新、关闭页面或句柄变化后，未完成文件会从头重新计算。</footer>
        </section>
      )}

      {duplicateReport.hashedRecords > 0 && (
        <section className={`media-duplicate-report ${duplicateReport.groups.length ? "has-duplicates" : "clear"}`}>
          <header><div><span>DUPLICATE CONTENT REPORT / 只读</span><h3>{duplicateReport.groups.length ? `发现 ${duplicateReport.groups.length} 组完整内容相同` : "已哈希内容未发现重复组"}</h3><p>只有文件大小和完整 SHA-256 同时一致才进入报告；名称、路径和采样指纹不参与判重。</p></div><div><span><small>已有完整哈希</small><strong>{duplicateReport.hashedRecords}</strong></span><span><small>重复组</small><strong>{duplicateReport.groups.length}</strong></span><span><small>组内记录</small><strong>{duplicateReport.duplicateRecords}</strong></span></div></header>
          {duplicateReport.groups.length > 0 && <div className="duplicate-content-groups">{duplicateReport.groups.map((group, index) => <article key={`${group.size}:${group.fullHash}`}><header><i>{String(index + 1).padStart(2, "0")}</i><span><strong>{formatBytes(group.size)} · {group.records.length} 条索引</strong><code>{group.fullHash.slice(0, 20)}…{group.fullHash.slice(-10)}</code></span></header><div>{group.records.map((record) => <span key={record.sourceKey}><strong>{record.name}</strong><small>{videoBySource.get(record.sourceKey)?.title || "已删除的本地来源"}</small></span>)}</div></article>)}</div>}
          <footer><i>!</i><span><strong>报告不执行清理，也不推荐删除哪一份。</strong>不同索引可能是有意保留的副本；如需处理，请先在磁盘中人工确认用途和备份。</span></footer>
        </section>
      )}

      <section className="media-duplicate-audit-dock">
        <header>
          <div><span>DUPLICATE AUDIT / 跨设备只读</span><h3>把重复结论带走，不把文件线索带走。</h3><p>导出只重算已有索引的统计与封签，不重新读取原文件；导入只做结构、完整性与本机报告对照。</p></div>
          <div><button onClick={() => void exportDuplicateAudit()} disabled={Boolean(busy) || duplicateReport.hashedRecords < 1}>{busy === "audit-export" ? "正在封装…" : "导出无内容摘要"}<small>JSON ≤ 64KB</small></button><button onClick={() => duplicateAuditInput.current?.click()} disabled={Boolean(busy)}>{busy === "audit-read" ? "正在核对…" : "读取另一台设备摘要"}<small>只读</small></button><input ref={duplicateAuditInput} type="file" accept="application/json,.json" onChange={readDuplicateAudit} hidden /></div>
        </header>
        <div className="media-audit-redaction-rail" aria-label="审计摘要隐私边界"><span>EXCLUDED</span><s>文件名</s><s>路径</s><s>来源 ID</s><s>原始哈希</s><i>→</i><strong>计数 + 组集合封签</strong></div>
        {duplicateAudit ? (
          <article className={`media-duplicate-audit-proof ${duplicateAudit.comparison.matches ? "matches" : "differs"}`}>
            <div className="media-audit-proof-mark"><i>✓</i><span><strong>SHA-256 完整性封签有效</strong><small>{duplicateAudit.fileName}</small></span></div>
            <div className="media-audit-proof-facts"><span><small>完整哈希</small><strong>{duplicateAudit.inspection.receipt.summary.completeHashRecords}</strong></span><span><small>重复组</small><strong>{duplicateAudit.inspection.receipt.summary.duplicateGroups}</strong></span><span><small>组内记录</small><strong>{duplicateAudit.inspection.receipt.summary.duplicateRecords}</strong></span><span><small>组内字节</small><strong>{formatBytes(duplicateAudit.inspection.receipt.summary.duplicateBytes)}</strong></span></div>
            <code>{duplicateAudit.inspection.digest.slice(0, 20)}…{duplicateAudit.inspection.digest.slice(-10)}</code>
            <div className="media-audit-proof-comparison"><strong>{duplicateAudit.comparison.matches ? "与本机重复报告逐项一致" : "与本机重复报告不一致"}</strong><span>{duplicateAudit.comparison.matches ? "计数和匿名组集合封签一致；没有导入、覆盖或清理任何索引。" : duplicateAudit.comparison.reasons.join("；")}</span></div>
          </article>
        ) : <small>摘要的组集合封签可跨设备比较，但仍只是 SHA-256 完整性证据，不能证明由哪台设备生成；已知候选完整哈希的一方仍可能验证猜测。</small>}
      </section>

      {rows.length ? (
        <div className="external-media-ledger">
          {rows.map((row) => {
            const saved = videoBySource.get(row.sourceKey);
            return (
              <article key={row.sourceKey} className={`${row.status} ${selected.has(row.sourceKey) ? "selected" : ""}`}>
                <label><input type="checkbox" checked={selected.has(row.sourceKey)} onChange={() => toggleSelection(row.sourceKey)} disabled={Boolean(busy)} /><i /></label>
                <div className="media-ledger-file"><span>{saved?.title || "已删除的本地来源"}</span><strong>{row.name}</strong><small>{formatBytes(row.size)} · 修改于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.lastModified))}</small></div>
                <div className="media-ledger-health"><span>{statusLabels[row.status]}</span><p>{row.detail}</p>{row.status === "permission" && <button onClick={() => void authorizeAndVerify(row.sourceKey)} disabled={Boolean(busy)}>{busy === "permission" ? "正在核对…" : "授权并复查"}</button>}</div>
                <div className="fingerprint-rail"><span><small>SAMPLED / 首尾 64 KiB</small><code>{row.fingerprint ? `${row.fingerprint.slice(0, 16)}…${row.fingerprint.slice(-8)}` : "旧索引缺少采样证据"}</code></span><i /><span className={row.fullHash ? "complete" : "pending"}><small>FULL / 完整文件内容</small><code>{row.fullHash ? `${row.fullHash.slice(0, 16)}…${row.fullHash.slice(-8)}` : "尚未计算"}</code></span></div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="external-media-empty"><i>⌁</i><span><strong>还没有外部原文件索引</strong><p>用上方“选择并保留外部索引”导入本地媒体后，这里会显示句柄健康和两级指纹证据。</p></span></div>
      )}

      <footer><i />完整 SHA-256 以 4 MiB 分块读取并在块间让出主线程；索引、句柄、队列结果和哈希只留在当前浏览器，不进入工作台、迁移卷、同步包或模型请求。</footer>
    </section>
  );
}
