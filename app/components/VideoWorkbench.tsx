"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { segmentTranscript } from "../features/transcript-core.mjs";
import { loadTranscript, loadVisualFrames, saveTranscript, saveVisualFrames } from "../features/transcript-store.mjs";
import {
  loadExternalMediaInfo,
  openExternalMediaFile,
  saveExternalMediaHandle,
  supportsExternalMediaHandles,
} from "../features/external-media-store.mjs";
import type { ExternalMediaInfo } from "../features/external-media-store.mjs";
import type { KnowledgeCard, KnowledgeInquiry, VideoRecord, VideoSummary, VisualEvidenceFrame } from "../features/workbench-core.mjs";
import { TranscriptStudio } from "./TranscriptStudio";
import { VisualEvidenceStudio, type VisualFrameDraft } from "./VisualEvidenceStudio";

type ImportedVideo = Omit<VideoRecord, "id" | "summary" | "createdAt" | "transcriptSource" | "localFileName" | "visualEvidence"> & {
  inputUrl: string;
  transcript: string | null;
  transcriptSource: "platform" | "local-whisper" | "unavailable";
  importedAt: string;
  uploadId?: string;
  localFileName?: string;
};

type TranscriptionStatus = {
  runtime: {
    whisper: boolean;
    ffmpeg: boolean;
    ytDlp: boolean;
    tesseract: boolean;
    ocrLanguages: string[];
    ready: boolean;
    localReady: boolean;
    visualReady: boolean;
    ocrReady: boolean;
  };
  model: {
    name: string;
    filename: string;
    expectedBytes: number;
    ready: boolean;
    bytes: number;
    reason: string | null;
  };
  downloading: boolean;
  transcribing: boolean;
  extractingVisuals: boolean;
};

type VideoWorkbenchProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  initialUrl: string;
  videos: VideoRecord[];
  knowledge: KnowledgeCard[];
  onNeedSettings: () => void;
  onSave: (video: Omit<VideoRecord, "id" | "createdAt"> & { capturedUrl?: string }, createTasks: boolean) => void;
  onSaveInquiry: (inquiry: Omit<KnowledgeInquiry, "id" | "createdAt">) => void;
  onCreateTask: (task: { title: string; note: string }) => void;
};

const platformNames: Record<ImportedVideo["platform"], string> = {
  youtube: "YouTube",
  bilibili: "哔哩哔哩",
  xiaohongshu: "小红书",
  douyin: "抖音",
  local: "本地文件",
};

type FilePickerGlobal = typeof globalThis & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
};

const localMediaPickerOptions = {
  multiple: false,
  types: [{
    description: "音频或视频文件",
    accept: {
      "video/*": [".mp4", ".mov", ".mkv", ".webm"],
      "audio/*": [".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"],
    },
  }],
};

function companionUrl(path: string) {
  const protocol = globalThis.location?.protocol === "https:" ? "https:" : "http:";
  const hostname = globalThis.location?.hostname || "localhost";
  return `${protocol}//${hostname}:4242${path}`;
}

function durationLabel(seconds: number | null) {
  if (!seconds) return "时长未知";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function densityLabel(value: VideoSummary["informationDensity"]) {
  return value === "high" ? "高密度" : value === "low" ? "低密度" : "中密度";
}

function transcriptSourceLabel(video: ImportedVideo, transcript: string) {
  if (video.transcriptSource === "platform") return "平台字幕";
  if (video.transcriptSource === "local-whisper") return "本地 Whisper";
  return transcript.trim() ? "手动文本" : "等待来源";
}

export function VideoWorkbench({
  baseURL,
  apiKey,
  model,
  initialUrl,
  videos,
  knowledge,
  onNeedSettings,
  onSave,
  onSaveInquiry,
  onCreateTask,
}: VideoWorkbenchProps) {
  const [sourceMode, setSourceMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState(initialUrl);
  const [video, setVideo] = useState<ImportedVideo | null>(null);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState<VideoSummary | null>(null);
  const [visualFrames, setVisualFrames] = useState<VisualFrameDraft[]>([]);
  const [busy, setBusy] = useState<"" | "import" | "upload" | "bind" | "reopen" | "model" | "transcribe" | "visual" | "summarize">("");
  const [message, setMessage] = useState("粘贴视频链接，先读取真实元数据与字幕");
  const [savedMode, setSavedMode] = useState<"" | "knowledge" | "tasks">("");
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus | null>(null);
  const [transcriptStored, setTranscriptStored] = useState(false);
  const [visualStored, setVisualStored] = useState(false);
  const [externalMediaInfo, setExternalMediaInfo] = useState<ExternalMediaInfo | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(companionUrl("/api/video/transcription/status"), { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { status?: TranscriptionStatus };
        if (response.ok && data.status) setTranscriptionStatus(data.status);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const relatedCards = useMemo(
    () => summary && video ? knowledge.filter((card) => card.sourceUrl === video.url) : [],
    [knowledge, summary, video],
  );

  async function discardPendingUpload(current: ImportedVideo | null) {
    if (!current?.uploadId) return;
    await fetch(companionUrl("/api/video/upload/discard"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: current.uploadId }),
    }).catch(() => {});
  }

  async function importFromUrl(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy("import");
    setMessage("本地导入器正在读取元数据，并优先寻找平台字幕…");
    setSummary(null);
    setSavedMode("");
    setTranscriptStored(false);
    setVisualFrames([]);
    setVisualStored(false);
    setExternalMediaInfo(null);
    try {
      await discardPendingUpload(video);
      const response = await fetch(companionUrl("/api/video/import"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await response.json()) as { error?: string; video?: ImportedVideo };
      if (!response.ok || !data.video) throw new Error(data.error || "没有读取到视频信息");
      setVideo(data.video);
      setUrl(data.video.url);
      setTranscript(data.video.transcript || "");
      setMessage(data.video.transcript
        ? `已获取平台字幕 · ${data.video.transcript.length.toLocaleString("zh-CN")} 字符`
        : "平台没有提供可用字幕；可在本机转录音频，也可以手动粘贴文本");
    } catch (error) {
      setVideo(null);
      setTranscript("");
      setVisualFrames([]);
      setMessage(error instanceof Error ? error.message : "视频导入失败");
    } finally {
      setBusy("");
    }
  }

  function validateLocalMediaFile(file: File) {
    if (file.size > 500 * 1024 * 1024) {
      throw new Error("本地音视频超过 500MB 安全上限");
    }
    if (!file.size) throw new Error("本地音视频文件为空");
  }

  async function uploadLocalMedia(file: File) {
    validateLocalMediaFile(file);
    const response = await fetch(companionUrl("/api/video/upload"), {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-evolve-file-name": encodeURIComponent(file.name),
        "x-evolve-file-size": String(file.size),
        "x-evolve-file-type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const data = (await response.json()) as { error?: string; video?: ImportedVideo };
    if (!response.ok || !data.video) throw new Error(data.error || "没有读取到本地媒体信息");
    return data.video;
  }

  async function stageLocalMedia(file: File, handle?: FileSystemFileHandle) {
    setBusy("upload");
    setMessage("正在把文件交给本机导入器读取；文件不会离开这台设备…");
    setSummary(null);
    setSavedMode("");
    setTranscriptStored(false);
    setVisualFrames([]);
    setVisualStored(false);
    setExternalMediaInfo(null);
    try {
      await discardPendingUpload(video);
      const imported = await uploadLocalMedia(file);
      let indexed: ExternalMediaInfo | null = null;
      if (handle) {
        try {
          indexed = await saveExternalMediaHandle(imported.url, handle);
        } catch {
          indexed = null;
        }
      }
      setVideo(imported);
      setUrl("");
      setTranscript("");
      setExternalMediaInfo(indexed);
      setMessage(`已读取 ${imported.localFileName || file.name} · 文件仅临时保留，保存或转录后立即删除${indexed ? "；外部原文件索引已绑定" : handle ? "；浏览器未能保存外部索引" : ""}`);
    } catch (error) {
      setVideo(null);
      setTranscript("");
      setVisualFrames([]);
      setMessage(error instanceof Error ? error.message : "本地文件导入失败");
    } finally {
      setBusy("");
    }
  }

  async function importFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await stageLocalMedia(file);
  }

  async function importWithExternalIndex() {
    if (!supportsExternalMediaHandles()) {
      setMessage("当前浏览器不支持持久化文件句柄；仍可使用上方普通本地导入");
      return;
    }
    try {
      const [handle] = await (globalThis as FilePickerGlobal).showOpenFilePicker?.(localMediaPickerOptions) || [];
      if (!handle) return;
      await stageLocalMedia(await handle.getFile(), handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "无法建立外部原文件索引");
    }
  }

  async function bindExternalOriginal() {
    if (!video || video.platform !== "local") return;
    if (!supportsExternalMediaHandles()) {
      setMessage("当前浏览器不支持持久化文件句柄，不能绑定外部原文件");
      return;
    }
    try {
      const [handle] = await (globalThis as FilePickerGlobal).showOpenFilePicker?.(localMediaPickerOptions) || [];
      if (!handle) return;
      setBusy("bind");
      const file = await handle.getFile();
      validateLocalMediaFile(file);
      if (video.localFileName && file.name !== video.localFileName) throw new Error(`请选择原文件“${video.localFileName}”`);
      const info = await saveExternalMediaHandle(video.url, handle);
      setExternalMediaInfo(info);
      setMessage("外部原文件索引已绑定；仅保存文件句柄与采样指纹，不复制原文件");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "无法绑定外部原文件");
    } finally {
      setBusy("");
    }
  }

  async function reopenExternalOriginal() {
    if (!video || video.platform !== "local") return;
    setBusy("reopen");
    setMessage("正在请求外部原文件读取权限并核对采样指纹…");
    try {
      const opened = await openExternalMediaFile(video.url);
      await discardPendingUpload(video);
      const imported = await uploadLocalMedia(opened.file);
      setVideo((current) => current ? {
        ...current,
        uploadId: imported.uploadId,
        hasVideo: imported.hasVideo,
        width: imported.width,
        height: imported.height,
      } : current);
      setExternalMediaInfo(opened.info);
      setMessage("外部原文件指纹一致，已建立短期本机处理副本；保存或转录后仍会删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法重新打开外部原文件");
    } finally {
      setBusy("");
    }
  }

  async function downloadModel() {
    setBusy("model");
    setMessage("正在下载并校验约 142 MiB 的多语言 Whisper 模型；完成前不会开始转录…");
    try {
      const response = await fetch(companionUrl("/api/video/transcription/model"), { method: "POST" });
      const data = (await response.json()) as { error?: string; status?: TranscriptionStatus };
      if (!response.ok || !data.status) throw new Error(data.error || "模型没有准备完成");
      setTranscriptionStatus({ ...data.status, downloading: false });
      setMessage("本地 Whisper 模型已通过大小与校验和验证，可以开始转录");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "模型下载失败");
    } finally {
      setBusy("");
    }
  }

  async function extractVisuals(target: ImportedVideo | null = video) {
    if (!target?.hasVideo) {
      setMessage("当前来源没有视频轨道，无法抽取画面");
      return [] as VisualFrameDraft[];
    }
    setBusy("visual");
    setMessage("正在本机抽取关键采样帧并运行 OCR；平台临时视频完成后会立即删除…");
    try {
      const candidates = segmentTranscript(transcript).map((segment) => segment.seconds).filter((seconds): seconds is number => seconds !== null);
      const response = await fetch(companionUrl("/api/video/visual-evidence"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target.platform === "local"
          ? { uploadId: target.uploadId, candidates }
          : { url: target.url, candidates }),
      });
      const data = (await response.json()) as {
        error?: string;
        visualEvidence?: {
          frames: Array<Pick<VisualEvidenceFrame, "id" | "seconds" | "timestamp" | "ocrText"> & { imageDataUrl: string }>;
          ocr: { available: boolean; languages: string[] };
        };
      };
      if (!response.ok || !data.visualEvidence?.frames.length) throw new Error(data.error || "本机没有返回可用画面");
      const nextFrames = data.visualEvidence.frames.map((frame, index) => ({
        ...frame,
        modelText: "",
        observation: "",
        uncertainty: "",
        included: index < 6,
      }));
      setVisualFrames(nextFrames);
      setVisualStored(false);
      setSummary(null);
      setSavedMode("");
      setMessage(`已抽取 ${nextFrames.length} 帧 · ${data.visualEvidence.ocr.available ? "本机 OCR 已完成" : "未检测到 OCR，图片仍可核对"}`);
      return nextFrames;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "画面抽取失败");
      return [] as VisualFrameDraft[];
    } finally {
      setBusy("");
    }
  }

  async function transcribe() {
    if (!video) return;
    if (video.platform === "local" && video.hasVideo && !visualFrames.length) await extractVisuals(video);
    setBusy("transcribe");
    setMessage("正在下载临时音频并使用本机 Whisper 转录；音频处理后会立即删除…");
    try {
      const response = await fetch(companionUrl("/api/video/transcribe"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(video.platform === "local" ? { uploadId: video.uploadId } : { url: video.url }),
      });
      const data = (await response.json()) as {
        error?: string;
        transcription?: { transcript: string; transcriptSource: "local-whisper"; model: string };
      };
      if (!response.ok || !data.transcription) throw new Error(data.error || "本地转录没有返回文本");
      setTranscript(data.transcription.transcript);
      setVideo((current) => current ? {
        ...current,
        transcript: data.transcription?.transcript || null,
        transcriptSource: "local-whisper",
        ...(current.platform === "local" ? { uploadId: undefined } : {}),
      } : current);
      setMessage(`本地转录完成 · ${data.transcription.transcript.length.toLocaleString("zh-CN")} 字符 · 临时音频已删除`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本地转录失败");
    } finally {
      setBusy("");
    }
  }

  async function summarize() {
    if (!video) {
      setMessage("先导入视频，再开始总结");
      return;
    }
    if (transcript.trim().length < 80) {
      setMessage("需要至少 80 个字符的字幕或转写文本，不能只凭标题生成总结");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；字幕只会发送到你配置的本机服务");
      onNeedSettings();
      return;
    }
    setBusy("summarize");
    setMessage("视频 Agent 正在核对字幕、组织章节并提炼可执行结果…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "summarize-video",
          baseURL,
          apiKey,
          model,
          video: {
            url: video.url,
            platform: video.platform,
            title: video.title,
            author: video.author,
            duration: video.duration,
            description: video.description,
          },
          transcript,
          visualEvidence: visualFrames.filter((frame) => frame.included).map((frame) => ({
            id: frame.id,
            seconds: frame.seconds,
            timestamp: frame.timestamp,
            ocrText: frame.ocrText,
            modelText: frame.modelText,
            observation: frame.observation,
            uncertainty: frame.uncertainty,
          })),
        }),
      });
      const data = (await response.json()) as { error?: string; summary?: VideoSummary };
      if (!response.ok || !data.summary) throw new Error(data.error || "模型没有返回视频总结");
      setSummary(data.summary);
      setSavedMode("");
      setMessage("结构化总结已生成；保存前仍不会改变知识库或任务");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视频总结失败");
    } finally {
      setBusy("");
    }
  }

  async function save(createTasks: boolean) {
    if (!video || !summary) return;
    onSave({
      capturedUrl: video.inputUrl,
      url: video.url,
      platform: video.platform,
      sourceId: video.sourceId,
      title: video.title,
      author: video.author,
      description: video.description,
      duration: video.duration,
      thumbnail: video.thumbnail,
      hasVideo: video.hasVideo,
      width: video.width,
      height: video.height,
      localFileName: video.localFileName || "",
      transcriptSource: video.transcriptSource === "platform"
        ? "platform"
        : video.transcriptSource === "local-whisper" ? "local-whisper" : "manual",
      visualEvidence: visualFrames.map((frame) => ({
        id: frame.id,
        seconds: frame.seconds,
        timestamp: frame.timestamp,
        ocrText: frame.ocrText,
        modelText: frame.modelText,
        observation: frame.observation,
        uncertainty: frame.uncertainty,
      })),
      summary,
    }, createTasks);
    const [stored, storedVisuals] = await Promise.all([
      saveTranscript(video.url, transcript),
      visualFrames.length ? saveVisualFrames(video.url, visualFrames) : Promise.resolve(false),
    ]);
    await discardPendingUpload(video);
    setVideo((current) => current ? { ...current, uploadId: undefined } : current);
    setTranscriptStored(stored);
    setVisualStored(storedVisuals);
    setSavedMode(createTasks ? "tasks" : "knowledge");
    setMessage(createTasks
      ? `已保存 ${summary.cards.length} 张知识卡片，并加入 ${summary.suggestedTasks.length} 个任务${stored ? "；字幕已存浏览器" : "；字幕未能持久化"}${visualFrames.length ? storedVisuals ? "；画面已存浏览器" : "；画面未能持久化" : ""}`
      : `已保存视频总结和 ${summary.cards.length} 张知识卡片${stored ? "；字幕已存浏览器" : "；字幕未能持久化"}${visualFrames.length ? storedVisuals ? "；画面已存浏览器" : "；画面未能持久化" : ""}`);
  }

  async function openSaved(saved: VideoRecord) {
    setUrl(saved.url);
    setVideo({
      inputUrl: saved.url,
      url: saved.url,
      platform: saved.platform,
      sourceId: saved.sourceId,
      title: saved.title,
      author: saved.author,
      description: saved.description,
      duration: saved.duration,
      thumbnail: saved.thumbnail,
      hasVideo: saved.hasVideo,
      width: saved.width,
      height: saved.height,
      localFileName: saved.localFileName,
      transcript: null,
      transcriptSource: saved.transcriptSource === "platform"
        ? "platform"
        : saved.transcriptSource === "local-whisper" ? "local-whisper" : "unavailable",
      importedAt: saved.createdAt,
    });
    const [savedTranscript, storedFrames, externalInfo] = await Promise.all([
      loadTranscript(saved.url).catch(() => ""),
      loadVisualFrames(saved.url).catch(() => []),
      saved.platform === "local" ? loadExternalMediaInfo(saved.url).catch(() => null) : Promise.resolve(null),
    ]);
    const imageById = new Map(storedFrames.map((frame) => [frame.id, frame.imageDataUrl]));
    const restoredFrames = saved.visualEvidence.map((frame, index) => ({
      ...frame,
      imageDataUrl: imageById.get(frame.id) || "",
      included: index < 6,
    }));
    setTranscript(savedTranscript);
    setTranscriptStored(Boolean(savedTranscript));
    setVisualFrames(restoredFrames);
    setVisualStored(Boolean(restoredFrames.length && restoredFrames.every((frame) => frame.imageDataUrl)));
    setExternalMediaInfo(externalInfo);
    setSourceMode(saved.platform === "local" ? "file" : "url");
    setSummary(saved.summary);
    setSavedMode("knowledge");
    setMessage(savedTranscript
      ? `已恢复字幕${restoredFrames.length ? `与 ${restoredFrames.length} 帧视觉证据` : ""}，可继续搜索和提问${externalInfo ? "；外部原文件索引仍在本机" : ""}`
      : `这条旧总结没有持久化字幕；重新生成前需要再次导入来源${externalInfo ? "，或从已绑定外部原文件重新打开" : ""}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="video-workbench">
      <div className="workspace-heading video-heading">
        <div>
          <p className="eyebrow">视频理解 · 本地优先</p>
          <h1>不止缩短观看时间，<em>还要把内容变成下一步。</em></h1>
        </div>
        <div className="video-privacy"><i>✓</i><span><strong>字幕不进云端工作台</strong><small>仅发往你配置的本地模型</small></span></div>
      </div>

      <div className="video-pipeline" aria-label="视频总结流程">
        <div className={video ? "done" : "active"}><i>1</i><span><strong>导入</strong><small>元数据与字幕</small></span></div><b />
        <div className={transcript || visualFrames.length ? "done" : video ? "active" : ""}><i>2</i><span><strong>核对</strong><small>字幕与真实画面</small></span></div><b />
        <div className={summary ? "done" : transcript ? "active" : ""}><i>3</i><span><strong>理解</strong><small>章节与要点</small></span></div><b />
        <div className={savedMode ? "done" : summary ? "active" : ""}><i>4</i><span><strong>再利用</strong><small>知识卡与任务</small></span></div>
      </div>

      <div className="video-source-tabs" aria-label="选择视频来源">
        <button className={sourceMode === "url" ? "active" : ""} onClick={() => setSourceMode("url")}><i>↗</i><span><strong>视频链接</strong><small>平台字幕优先</small></span></button>
        <button className={sourceMode === "file" ? "active" : ""} onClick={() => setSourceMode("file")}><i>＋</i><span><strong>本地文件</strong><small>音频或视频 · ≤ 500MB</small></span></button>
      </div>

      {sourceMode === "url" ? (
        <form className="video-import-bar" onSubmit={importFromUrl}>
          <label htmlFor="video-url">视频链接</label>
          <input id="video-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="粘贴 B站、YouTube、小红书或抖音链接" />
          <button disabled={Boolean(busy) || !url.trim()}>{busy === "import" ? "正在导入…" : "读取视频"}<span>↘</span></button>
        </form>
      ) : (
        <div className="local-media-import-stack">
          <label className={`local-media-drop ${busy === "upload" ? "busy" : ""}`}>
            <input type="file" accept="audio/*,video/*,.mkv,.m4a,.flac,.aac" onChange={(event) => void importFromFile(event)} disabled={Boolean(busy)} />
            <i>{busy === "upload" ? "…" : "＋"}</i>
            <span><strong>{busy === "upload" ? "正在本机读取文件" : "选择音频或视频文件"}</strong><small>MP4 · MOV · MKV · WebM · MP3 · M4A · WAV · OGG · AAC · FLAC</small></span>
            <b>普通临时导入</b>
          </label>
          <button type="button" className="indexed-media-picker" onClick={() => void importWithExternalIndex()} disabled={Boolean(busy)}><i>⌁</i><span><strong>选择并保留外部索引</strong><small>句柄与采样指纹进独立本地库 · 原文件不复制</small></span><b>可选</b></button>
        </div>
      )}

      {video ? (
        <div className="video-source-grid">
          <article className="video-source-card">
            <div className="video-cover">
              {video.thumbnail
                ? <span className="video-cover-image" style={{ backgroundImage: `url(${JSON.stringify(video.thumbnail)})` }} aria-hidden="true" />
                : <span className="video-cover-play">▶</span>}
              <i>{platformNames[video.platform]}</i>
              <b>{durationLabel(video.duration)}</b>
            </div>
            <div className="video-source-copy">
              <span>已读取来源</span>
              <h2>{video.title}</h2>
              <p>{video.author || "作者未知"}</p>
              {video.platform === "local" ? (
                <div className={`external-media-custody ${externalMediaInfo ? "bound" : ""}`}>
                  <span><i>{video.uploadId ? "●" : externalMediaInfo ? "⌁" : "○"}</i><strong>{video.uploadId ? "短期处理副本已就绪" : externalMediaInfo ? "外部原文件已索引" : "原文件未绑定"}</strong><small>{externalMediaInfo ? `${externalMediaInfo.name} · ${externalMediaInfo.fingerprint.slice(0, 12)}…` : "保存或转录后，临时文件会删除"}</small></span>
                  {video.uploadId
                    ? !externalMediaInfo && <button type="button" onClick={() => void bindExternalOriginal()} disabled={Boolean(busy)}>{busy === "bind" ? "正在绑定…" : "绑定原文件"}</button>
                    : externalMediaInfo
                      ? <button type="button" onClick={() => void reopenExternalOriginal()} disabled={Boolean(busy)}>{busy === "reopen" ? "正在核验…" : "重新打开"}</button>
                      : <button type="button" onClick={() => void bindExternalOriginal()} disabled={Boolean(busy)}>{busy === "bind" ? "正在绑定…" : "选择原文件"}</button>}
                </div>
              ) : <a href={video.url} target="_blank" rel="noreferrer">打开原视频 ↗</a>}
            </div>
          </article>

          <article className="transcript-card">
            <header>
              <div><span>字幕 / 转写</span><strong>{transcript ? `${transcript.length.toLocaleString("zh-CN")} 字符` : "等待文本"}</strong></div>
              <i className={video.transcriptSource === "platform" || video.transcriptSource === "local-whisper" ? "ready" : "manual"}>{transcriptSourceLabel(video, transcript)}</i>
            </header>
            {!transcript && video.transcriptSource === "unavailable" && (
              <div className="local-transcription-panel">
                <span><i>⌁</i><strong>本地转录 Plan B</strong><small>只在本机处理，临时音频完成后删除</small></span>
                {!transcriptionStatus ? (
                  <em>正在检测本机能力…</em>
                ) : !(video.platform === "local" ? transcriptionStatus.runtime.localReady : transcriptionStatus.runtime.ready) ? (
                  <div><p>缺少 {[
                    !transcriptionStatus.runtime.whisper && "whisper-cpp",
                    !transcriptionStatus.runtime.ffmpeg && "ffmpeg",
                    video.platform !== "local" && !transcriptionStatus.runtime.ytDlp && "yt-dlp",
                  ].filter(Boolean).join("、")}</p><code>{video.platform === "local" ? "brew install whisper-cpp ffmpeg" : "brew install whisper-cpp ffmpeg yt-dlp"}</code></div>
                ) : !transcriptionStatus.model.ready ? (
                  <button type="button" onClick={() => void downloadModel()} disabled={Boolean(busy)}>{busy === "model" ? "正在下载并校验…" : "下载多语言模型 · 约 142 MiB"}</button>
                ) : (
                  <button type="button" className="ready" onClick={() => void transcribe()} disabled={Boolean(busy)}>{busy === "transcribe" ? "正在本机转录…" : "开始本地转录"}</button>
                )}
              </div>
            )}
            <textarea value={transcript} onChange={(event) => setTranscript(event.target.value.slice(0, 100_000))} placeholder="没有自动字幕时，把平台字幕、飞书妙记或其他转写文本粘贴到这里。带时间戳的文本会生成可定位章节。" aria-label="视频字幕或转写文本" />
            <footer><span>总结严格以这份文本为准</span><button disabled={Boolean(busy) || transcript.trim().length < 80} onClick={() => void summarize()}>{busy === "summarize" ? "正在理解…" : "生成结构化总结"}<b>✦</b></button></footer>
          </article>
        </div>
      ) : (
        <div className="video-empty-state">
          <div className="empty-film" aria-hidden="true"><i /><i /><span>▶</span></div>
          <div><strong>从一条真实视频开始</strong><p>本地导入器先找平台字幕；找不到时可切换本机 Whisper 转录。没有真实文本证据，就不会让模型看标题猜内容。</p></div>
        </div>
      )}

      <p className="video-status"><i className={busy ? "busy" : ""} />{message}</p>

      {video && (
        <VisualEvidenceStudio
          video={{ title: video.title, hasVideo: video.hasVideo, canExtract: video.platform !== "local" || Boolean(video.uploadId) }}
          frames={visualFrames}
          baseURL={baseURL}
          apiKey={apiKey}
          model={model}
          extracting={busy === "visual"}
          ocrReady={Boolean(transcriptionStatus?.runtime.ocrReady)}
          ocrLanguages={transcriptionStatus?.runtime.ocrLanguages || []}
          stored={visualStored}
          onExtract={async () => { await extractVisuals(); }}
          onChange={(frames) => { setVisualFrames(frames); setSummary(null); setSavedMode(""); }}
          onNeedSettings={onNeedSettings}
        />
      )}

      {video && transcript.trim().length >= 80 && (
        <TranscriptStudio
          key={`${video.url}-${transcript.length}`}
          transcript={transcript}
          video={{ title: video.title, url: video.url, platform: video.platform }}
          visualFrames={visualFrames.filter((frame) => frame.included)}
          baseURL={baseURL}
          apiKey={apiKey}
          model={model}
          stored={transcriptStored}
          onNeedSettings={onNeedSettings}
          onSave={onSaveInquiry}
          onCreateTask={onCreateTask}
        />
      )}

      {summary && video && (
        <article className="video-result">
          <header className="video-verdict">
            <div><span>一句话结论</span><h2>{summary.oneSentence}</h2><p>{summary.worthWatching}</p></div>
            <aside><i className={summary.informationDensity}>{densityLabel(summary.informationDensity)}</i><strong>适合谁</strong><p>{summary.audience}</p></aside>
          </header>

          <div className="video-result-grid">
            <section className="key-points-panel">
              <header><span>核心要点</span><b>{summary.keyPoints.length}</b></header>
              {summary.keyPoints.map((point, index) => <div key={`${point.title}-${index}`}><i>{point.timestamp || String(index + 1).padStart(2, "0")}</i><span><strong>{point.title}</strong><p>{point.detail}</p></span></div>)}
            </section>
            <section className="chapter-panel">
              <header><span>内容章节</span><b>{summary.chapters.length}</b></header>
              {summary.chapters.map((chapter, index) => <div key={`${chapter.title}-${index}`}><i>{chapter.timestamp || "—"}</i><span><strong>{chapter.title}</strong><p>{chapter.summary}</p></span></div>)}
            </section>
          </div>

          <div className="reuse-grid">
            <section className="creator-reading">
              <span>创作拆解</span>
              <div><strong>开头钩子</strong><p>{summary.creatorInsights.hook || "字幕不足以判断画面与开头钩子。"}</p></div>
              <div><strong>内容结构</strong><p>{summary.creatorInsights.structure || "未识别出稳定结构。"}</p></div>
              <div className="angle-list"><strong>可借鉴角度</strong>{summary.creatorInsights.angles.map((angle) => <p key={angle}>↗ {angle}</p>)}</div>
            </section>
            <section className="knowledge-preview">
              <header><span>将要保存</span><b>{summary.cards.length} 卡片 · {summary.suggestedTasks.length} 任务</b></header>
              {summary.cards.slice(0, 3).map((card) => <div key={card.title}><strong>{card.title}</strong><p>{card.content}</p><small>{card.tags.map((tag) => `#${tag}`).join(" ")}{card.evidenceFrameIds.length ? ` · ${card.evidenceFrameIds.length} 帧证据` : ""}</small></div>)}
              {summary.cards.length > 3 && <em>还有 {summary.cards.length - 3} 张知识卡片</em>}
            </section>
          </div>

          {summary.visualFindings.length > 0 && <section className="summary-visual-findings"><header><span>画面直接支持</span><b>{summary.visualFindings.length} 帧</b></header>{summary.visualFindings.map((finding) => <div key={`${finding.frameId}-${finding.observation}`}><time>{finding.timestamp}</time><p>{finding.observation}</p></div>)}</section>}

          {summary.caveats.length > 0 && <div className="summary-caveats"><span>阅读边界</span>{summary.caveats.map((item) => <p key={item}>! {item}</p>)}</div>}

          <footer className="video-save-actions">
            <p><i className={savedMode ? "saved" : ""} />{savedMode ? "已进入你的本地知识与行动系统" : "确认后才写入本地知识库"}</p>
            <div><button className="save-knowledge" onClick={() => void save(false)} disabled={Boolean(savedMode)}>只保存知识</button><button className="save-with-tasks" onClick={() => void save(true)} disabled={Boolean(savedMode)}>保存并生成任务 <span>↗</span></button></div>
          </footer>
        </article>
      )}

      {(videos.length > 0 || knowledge.length > 0) && (
        <section className="video-library">
          <header><div><p className="eyebrow">本地知识架</p><h2>看过之后，仍然找得到。</h2></div><span>{videos.length} 个视频 · {knowledge.length} 张卡片</span></header>
          <div className="saved-video-grid">
            {videos.slice().reverse().slice(0, 6).map((saved) => (
              <button key={saved.id} onClick={() => void openSaved(saved)}><i>{platformNames[saved.platform]}</i><strong>{saved.title}</strong><p>{saved.summary.oneSentence}</p><small>{saved.summary.cards.length} 张卡片{saved.visualEvidence.length ? ` · ${saved.visualEvidence.length} 帧` : ""}</small></button>
            ))}
          </div>
          {relatedCards.length > 0 && <p className="related-card-note">当前视频已有 {relatedCards.length} 张知识卡片保存在本机。</p>}
        </section>
      )}
    </section>
  );
}
