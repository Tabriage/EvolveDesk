"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import { searchTranscript, segmentTranscript, selectTranscriptEvidence, selectVisualEvidence, videoTimestampUrl } from "../features/transcript-core.mjs";
import type { TranscriptSegment } from "../features/transcript-core.mjs";
import type { KnowledgeInquiry, VisualEvidenceFrame } from "../features/workbench-core.mjs";

type KnowledgeDraft = Omit<KnowledgeInquiry, "id" | "createdAt">;
type VideoSource = KnowledgeInquiry["sources"][number] & {
  kind?: "transcript" | "frame";
  timestamp: string | null;
  seconds: number | null;
  text: string;
};
type VideoVisualFrame = VisualEvidenceFrame & { imageDataUrl: string; included: boolean };
type VideoAnswer = Omit<KnowledgeDraft, "sources"> & { sources: VideoSource[] };

type TranscriptStudioProps = {
  transcript: string;
  video: { title: string; url: string; platform: string };
  visualFrames: VideoVisualFrame[];
  baseURL: string;
  apiKey: string;
  model: string;
  stored: boolean;
  onNeedSettings: () => void;
  onSave: (inquiry: KnowledgeDraft) => void;
  onCreateTask: (task: { title: string; note: string }) => void;
};

const questionIdeas = [
  "这段内容给出了哪些可执行步骤？",
  "核心论点用了什么证据支持？",
  "哪些地方仍缺少上下文或验证？",
];

export function TranscriptStudio({
  transcript,
  video,
  visualFrames,
  baseURL,
  apiKey,
  model,
  stored,
  onNeedSettings,
  onSave,
  onCreateTask,
}: TranscriptStudioProps) {
  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<VideoAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [taskAdded, setTaskAdded] = useState(false);
  const [message, setMessage] = useState("搜索原话，或让 Agent 只依据相关字幕回答");
  const segments = useMemo(() => segmentTranscript(transcript), [transcript]);
  const visibleSegments = useMemo(() => searchTranscript(segments, search, 8), [segments, search]);
  const sourceIsPlayable = /^https:\/\//i.test(video.url);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const request = question.trim();
    if (request.length < 4) {
      setMessage("把问题写得再具体一点，至少 4 个字符");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；只会发送筛选后的字幕片段与相关画面");
      onNeedSettings();
      return;
    }
    const evidence = selectTranscriptEvidence(transcript, request, 12, 18_000);
    const frameEvidence = selectVisualEvidence(visualFrames, request, 4);
    if (!evidence.length && !frameEvidence.length) {
      setMessage("当前字幕和画面都没有可用于回答的资料");
      return;
    }
    setBusy(true);
    setAnswer(null);
    setSaved(false);
    setTaskAdded(false);
    setMessage(`正在核对 ${evidence.length} 段字幕与 ${frameEvidence.length} 帧画面，并验证模型返回的引用…`);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "ask-video",
          baseURL,
          apiKey,
          model,
          question: request,
          video,
          segments: evidence,
          frames: frameEvidence,
        }),
      });
      const data = (await response.json()) as { error?: string; answer?: VideoAnswer };
      if (!response.ok || !data.answer) throw new Error(data.error || "模型没有返回视频回答");
      setAnswer({ ...data.answer, question: request });
      setMessage(data.answer.answerable
        ? `回答已绑定 ${data.answer.sources.length} 个真实字幕或画面来源；保存前不会写入知识记忆`
        : "相关字幕与画面不足以完整回答，Agent 已保留资料缺口");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "视频问答失败");
    } finally {
      setBusy(false);
    }
  }

  function saveAnswer() {
    if (!answer || saved) return;
    onSave({
      ...answer,
      sources: answer.sources.map(({ cardId, cardTitle, sourceTitle, sourceUrl }) => ({ cardId, cardTitle, sourceTitle, sourceUrl })),
    });
    setSaved(true);
    setMessage("这次有据问答已保存到本机知识记忆");
  }

  function addSuggestedTask() {
    if (!answer?.suggestedTask || taskAdded) return;
    onCreateTask(answer.suggestedTask);
    setTaskAdded(true);
    setMessage("建议行动已加入今日任务");
  }

  function chooseQuestion(value: string) {
    setQuestion(value);
    setAnswer(null);
    setSaved(false);
    setTaskAdded(false);
  }

  return (
    <section className="transcript-studio">
      <header>
        <div><p className="eyebrow">时间证据轨 · 当前视频</p><h2>找到原话，再问这一段说明了什么。</h2></div>
        <span><strong>{segments.length}</strong> 段字幕<small>{visualFrames.length ? `另有 ${visualFrames.length} 帧画面` : stored ? "已存浏览器" : "保存总结后持久化"}</small></span>
      </header>

      <div className="transcript-studio-grid">
        <aside className="transcript-rail">
          <label><i>⌕</i><input value={search} onChange={(event) => setSearch(event.target.value.slice(0, 120))} placeholder="搜索字幕原话" aria-label="搜索当前视频字幕" /><small>{search ? `${visibleSegments.length} 处` : "前 8 段"}</small></label>
          <div className="transcript-hits">
            {visibleSegments.map((segment: TranscriptSegment & { score?: number }, index: number) => {
              const label = segment.timestamp || `片段 ${String(index + 1).padStart(2, "0")}`;
              const content = <><i /><time>{label}</time><p>{segment.text}</p></>;
              return sourceIsPlayable && segment.seconds !== null
                ? <a key={segment.id} href={videoTimestampUrl(video.url, segment.seconds)} target="_blank" rel="noreferrer">{content}</a>
                : <article key={segment.id}>{content}</article>;
            })}
            {!visibleSegments.length && <div className="transcript-no-match"><strong>没有找到原话</strong><p>换一个更短的词，或直接向 Agent 提问。</p></div>}
          </div>
        </aside>

        <main className="video-inquiry-desk">
          <header><span>Single-source Agent</span><strong>只读当前字幕与画面</strong></header>
          <div className="video-question-ideas">{questionIdeas.map((idea) => <button key={idea} onClick={() => chooseQuestion(idea)}>{idea}</button>)}</div>
          <form onSubmit={ask}>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 600))} placeholder="例如：作者建议先做哪三步？分别在哪个时间点说明？" aria-label="向当前视频提问" />
            <footer><span>{question.length}/600 · 最多 12 段字幕 + 4 帧画面</span><button disabled={busy || question.trim().length < 4}>{busy ? "正在核对…" : "从视频中回答"}<b>✦</b></button></footer>
          </form>

          {answer ? (
            <article className={`video-evidence-answer ${answer.answerable ? "answerable" : "limited"}`}>
              <header><span>{answer.answerable ? "字幕支持" : "资料不足"}</span><strong>{answer.sources.length} 个时间引用</strong></header>
              <h3>{answer.answer}</h3>
              {answer.keyPoints.length > 0 && <div className="video-answer-points">{answer.keyPoints.map((point, index) => <p key={point}><i>{String(index + 1).padStart(2, "0")}</i>{point}</p>)}</div>}
              {answer.sources.length > 0 && <div className="video-answer-sources"><span>回到原话</span>{answer.sources.map((source) => {
                const frame = source.kind === "frame" ? visualFrames.find((item) => item.id === source.cardId) : null;
                const evidence = <>{frame?.imageDataUrl && <Image unoptimized width={184} height={116} src={frame.imageDataUrl} alt={`${source.timestamp || "采样时间"} 的引用画面`} />}<strong>{source.timestamp || source.cardTitle}</strong><p>{source.text}</p></>;
                return sourceIsPlayable && source.seconds !== null
                  ? <a className={source.kind === "frame" ? "frame-source" : ""} key={`${source.kind}-${source.cardId}`} href={videoTimestampUrl(video.url, source.seconds)} target="_blank" rel="noreferrer">{evidence}</a>
                  : <article className={source.kind === "frame" ? "frame-source" : ""} key={`${source.kind}-${source.cardId}`}>{evidence}</article>;
              })}</div>}
              {answer.gaps.length > 0 && <div className="video-answer-gaps"><span>还不能确认</span>{answer.gaps.map((gap) => <p key={gap}>! {gap}</p>)}</div>}
              <footer><button onClick={saveAnswer} disabled={saved}>{saved ? "已保存问答" : "保存到知识记忆"}</button>{answer.suggestedTask && <button onClick={addSuggestedTask} disabled={taskAdded}>{taskAdded ? "已加入任务" : "加入建议行动 ↗"}</button>}</footer>
            </article>
          ) : <div className="video-answer-empty"><span>⌁</span><strong>每个结论都能回到时间点</strong><p>本地先缩小字幕与画面范围，模型不能把标题或外部常识混进回答。</p></div>}
          <p className="video-inquiry-message"><i className={busy ? "busy" : ""} />{message}</p>
        </main>
      </div>
    </section>
  );
}
