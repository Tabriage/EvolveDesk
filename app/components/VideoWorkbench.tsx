"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { KnowledgeCard, VideoRecord, VideoSummary } from "../features/workbench-core.mjs";

type ImportedVideo = Omit<VideoRecord, "id" | "summary" | "createdAt" | "transcriptSource"> & {
  inputUrl: string;
  transcript: string | null;
  transcriptSource: "platform" | "local-whisper" | "unavailable";
  importedAt: string;
};

type TranscriptionStatus = {
  runtime: { whisper: boolean; ffmpeg: boolean; ytDlp: boolean; ready: boolean };
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
};

const platformNames: Record<ImportedVideo["platform"], string> = {
  youtube: "YouTube",
  bilibili: "哔哩哔哩",
  xiaohongshu: "小红书",
  douyin: "抖音",
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
}: VideoWorkbenchProps) {
  const [url, setUrl] = useState(initialUrl);
  const [video, setVideo] = useState<ImportedVideo | null>(null);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState<VideoSummary | null>(null);
  const [busy, setBusy] = useState<"" | "import" | "model" | "transcribe" | "summarize">("");
  const [message, setMessage] = useState("粘贴视频链接，先读取真实元数据与字幕");
  const [savedMode, setSavedMode] = useState<"" | "knowledge" | "tasks">("");
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus | null>(null);

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

  async function importFromUrl(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy("import");
    setMessage("本地导入器正在读取元数据，并优先寻找平台字幕…");
    setSummary(null);
    setSavedMode("");
    try {
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
      setMessage(error instanceof Error ? error.message : "视频导入失败");
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

  async function transcribe() {
    if (!video) return;
    setBusy("transcribe");
    setMessage("正在下载临时音频并使用本机 Whisper 转录；音频处理后会立即删除…");
    try {
      const response = await fetch(companionUrl("/api/video/transcribe"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: video.url }),
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

  function save(createTasks: boolean) {
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
      transcriptSource: video.transcriptSource === "platform"
        ? "platform"
        : video.transcriptSource === "local-whisper" ? "local-whisper" : "manual",
      summary,
    }, createTasks);
    setSavedMode(createTasks ? "tasks" : "knowledge");
    setMessage(createTasks
      ? `已保存 ${summary.cards.length} 张知识卡片，并加入 ${summary.suggestedTasks.length} 个任务`
      : `已保存视频总结和 ${summary.cards.length} 张知识卡片`);
  }

  function openSaved(saved: VideoRecord) {
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
      transcript: null,
      transcriptSource: "unavailable",
      importedAt: saved.createdAt,
    });
    setTranscript("");
    setSummary(saved.summary);
    setSavedMode("knowledge");
    setMessage("正在查看已保存总结；重新生成前需要再次导入字幕");
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
        <div className={transcript ? "done" : video ? "active" : ""}><i>2</i><span><strong>核对</strong><small>真实文本来源</small></span></div><b />
        <div className={summary ? "done" : transcript ? "active" : ""}><i>3</i><span><strong>理解</strong><small>章节与要点</small></span></div><b />
        <div className={savedMode ? "done" : summary ? "active" : ""}><i>4</i><span><strong>再利用</strong><small>知识卡与任务</small></span></div>
      </div>

      <form className="video-import-bar" onSubmit={importFromUrl}>
        <label htmlFor="video-url">视频链接</label>
        <input id="video-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="粘贴 B站、YouTube、小红书或抖音链接" />
        <button disabled={Boolean(busy) || !url.trim()}>{busy === "import" ? "正在导入…" : "读取视频"}<span>↘</span></button>
      </form>

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
              <a href={video.url} target="_blank" rel="noreferrer">打开原视频 ↗</a>
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
                ) : !transcriptionStatus.runtime.ready ? (
                  <div><p>缺少 {[
                    !transcriptionStatus.runtime.whisper && "whisper-cpp",
                    !transcriptionStatus.runtime.ffmpeg && "ffmpeg",
                    !transcriptionStatus.runtime.ytDlp && "yt-dlp",
                  ].filter(Boolean).join("、")}</p><code>brew install whisper-cpp ffmpeg yt-dlp</code></div>
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
              {summary.cards.slice(0, 3).map((card) => <div key={card.title}><strong>{card.title}</strong><p>{card.content}</p><small>{card.tags.map((tag) => `#${tag}`).join(" ")}</small></div>)}
              {summary.cards.length > 3 && <em>还有 {summary.cards.length - 3} 张知识卡片</em>}
            </section>
          </div>

          {summary.caveats.length > 0 && <div className="summary-caveats"><span>阅读边界</span>{summary.caveats.map((item) => <p key={item}>! {item}</p>)}</div>}

          <footer className="video-save-actions">
            <p><i className={savedMode ? "saved" : ""} />{savedMode ? "已进入你的本地知识与行动系统" : "确认后才写入本地知识库"}</p>
            <div><button className="save-knowledge" onClick={() => save(false)} disabled={Boolean(savedMode)}>只保存知识</button><button className="save-with-tasks" onClick={() => save(true)} disabled={Boolean(savedMode)}>保存并生成任务 <span>↗</span></button></div>
          </footer>
        </article>
      )}

      {(videos.length > 0 || knowledge.length > 0) && (
        <section className="video-library">
          <header><div><p className="eyebrow">本地知识架</p><h2>看过之后，仍然找得到。</h2></div><span>{videos.length} 个视频 · {knowledge.length} 张卡片</span></header>
          <div className="saved-video-grid">
            {videos.slice().reverse().slice(0, 6).map((saved) => (
              <button key={saved.id} onClick={() => openSaved(saved)}><i>{platformNames[saved.platform]}</i><strong>{saved.title}</strong><p>{saved.summary.oneSentence}</p><small>{saved.summary.cards.length} 张卡片</small></button>
            ))}
          </div>
          {relatedCards.length > 0 && <p className="related-card-note">当前视频已有 {relatedCards.length} 张知识卡片保存在本机。</p>}
        </section>
      )}
    </section>
  );
}
