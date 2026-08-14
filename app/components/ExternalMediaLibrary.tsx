"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EXTERNAL_MEDIA_INDEX_CHANGED_EVENT,
  calculateExternalMediaFullHash,
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

function uncheckedRow(info: ExternalMediaInfo, validSources: Set<string>): LibraryRow {
  if (!validSources.has(info.sourceKey)) {
    return { ...info, status: "orphaned", permission: "unknown", checkedAt: "", detail: "对应的本地视频记录已经不存在" };
  }
  return { ...info, status: "unchecked", permission: "unknown", checkedAt: "", detail: "点击扫描后核对权限、元数据与采样指纹" };
}

export function ExternalMediaLibrary({ videos }: ExternalMediaLibraryProps) {
  const localVideos = useMemo(() => videos.filter((video) => video.platform === "local"), [videos]);
  const videoBySource = useMemo(() => new Map(localVideos.map((video) => [video.url, video])), [localVideos]);
  const validSourceKeys = useMemo(() => new Set(localVideos.map((video) => video.url)), [localVideos]);
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "scan" | "permission" | "relocate" | "hash" | "remove">("");
  const [message, setMessage] = useState("索引只记录浏览器文件句柄和指纹；维护动作不会移动、改名或删除磁盘原文件。 ");
  const [progress, setProgress] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);

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

  const totals = useMemo(() => ({
    ready: rows.filter((row) => row.status === "ready").length,
    attention: rows.filter((row) => ["permission", "changed", "missing", "orphaned"].includes(row.status)).length,
    full: rows.filter((row) => Boolean(row.fullHash)).length,
  }), [rows]);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.sourceKey)), [rows, selected]);

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
      setMessage("先选择需要建立完整 SHA-256 的可读取索引。 ");
      return;
    }
    const hashableRows = selectedRows.filter((row) => !["changed", "missing", "orphaned"].includes(row.status));
    const skipped = selectedRows.length - hashableRows.length;
    if (!hashableRows.length) {
      setMessage("所选索引都无法安全核对；请先重新定位内容变化或失效项，并移除孤立索引。 ");
      return;
    }
    setBusy("hash");
    setRemoveArmed(false);
    try {
      let completed = 0;
      for (const row of hashableRows) {
        await calculateExternalMediaFullHash(row.sourceKey, (processedBytes, totalBytes) => {
          const percent = Math.round((processedBytes / totalBytes) * 100);
          setProgress(`完整哈希 ${completed + 1}/${hashableRows.length} · ${row.name} · ${percent}%`);
        });
        completed += 1;
      }
      setRows(await scanExternalMediaIndex([...validSourceKeys]));
      setMessage(`已为 ${completed} 条索引保存完整 SHA-256${skipped ? `；${skipped} 条不可核对索引已跳过` : ""}。哈希只覆盖文件内容，不包含名称或路径。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法计算完整媒体哈希");
    } finally {
      setBusy("");
      setProgress("");
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
        <div><button onClick={() => void relocateSelected()} disabled={Boolean(busy) || !selected.size}>{busy === "relocate" ? "正在匹配…" : "重新定位所选"}</button><button onClick={() => void hashSelected()} disabled={Boolean(busy) || !selected.size}>{busy === "hash" ? "正在计算…" : "计算完整 SHA-256"}</button><button className={removeArmed ? "armed" : "danger"} onClick={() => void removeSelected()} disabled={Boolean(busy) || !selected.size}>{busy === "remove" ? "正在移除…" : removeArmed ? "再次点击，确认移除索引" : "移除所选索引"}</button></div>
      </div>

      <div className="media-maintenance-status" role="status"><i className={busy ? "working" : ""} /><span>{progress || message}</span><code>{selected.size} SELECTED</code></div>

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

      <footer><i />完整 SHA-256 以 4 MiB 分块读取，避免一次载入整份媒体；索引、句柄和哈希只留在独立 IndexedDB，不进入工作台、迁移卷、同步包或模型请求。</footer>
    </section>
  );
}
