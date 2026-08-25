"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { VisualEvidenceFrame } from "../features/workbench-core.mjs";

export type VisualFrameDraft = VisualEvidenceFrame & {
  imageDataUrl: string;
  included: boolean;
};

type VisualEvidenceStudioProps = {
  video: { title: string; hasVideo: boolean; canExtract: boolean };
  frames: VisualFrameDraft[];
  baseURL: string;
  apiKey: string;
  model: string;
  extracting: boolean;
  ocrReady: boolean;
  ocrLanguages: string[];
  stored: boolean;
  onExtract: () => Promise<void>;
  onChange: (frames: VisualFrameDraft[]) => void;
  onNeedSettings: () => void;
};

type FrameAnalysis = {
  overview: string;
  gaps: string[];
  frames: Array<{
    frameId: string;
    timestamp: string;
    seconds: number;
    observation: string;
    modelText: string;
    uncertainty: string;
  }>;
};

const languageLabels: Record<string, string> = { chi_sim: "简中", chi_tra: "繁中", eng: "英文" };

export function VisualEvidenceStudio({
  video,
  frames,
  baseURL,
  apiKey,
  model,
  extracting,
  ocrReady,
  ocrLanguages,
  stored,
  onExtract,
  onChange,
  onNeedSettings,
}: VisualEvidenceStudioProps) {
  const [activeId, setActiveId] = useState(frames[0]?.id || "");
  const [analyzing, setAnalyzing] = useState(false);
  const [overview, setOverview] = useState("");
  const [gaps, setGaps] = useState<string[]>([]);
  const [message, setMessage] = useState("画面只在本机抽取；选择后才发送到你配置的视觉模型");
  const active = frames.find((frame) => frame.id === activeId) || frames[0] || null;
  const included = useMemo(() => frames.filter((frame) => frame.included), [frames]);
  const analyzedCount = frames.filter((frame) => frame.observation).length;

  function toggleIncluded(frameId: string) {
    const target = frames.find((frame) => frame.id === frameId);
    if (!target) return;
    if (!target.included && included.length >= 6) {
      setMessage("视觉 Agent 一次最多核对 6 帧；先取消一帧再选择");
      return;
    }
    onChange(frames.map((frame) => frame.id === frameId ? { ...frame, included: !frame.included } : frame));
    setMessage(target.included ? "已从本次 Agent 资料中排除这帧" : "已加入本次 Agent 资料");
  }

  async function analyze() {
    if (!included.length) {
      setMessage("至少选择一帧，再让视觉 Agent 核对");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接支持图片的本地模型；图片不会发往其他地址");
      onNeedSettings();
      return;
    }
    setAnalyzing(true);
    setMessage(`正在逐帧核对 ${included.length} 张画面；本机 OCR 只作为待校验线索…`);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "analyze-video-frames",
          baseURL,
          apiKey,
          model,
          video: { title: video.title },
          frames: included,
        }),
      });
      const data = (await response.json()) as { error?: string; analysis?: FrameAnalysis };
      if (!response.ok || !data.analysis) throw new Error(data.error || "视觉模型没有返回逐帧结果");
      const byId = new Map(data.analysis.frames.map((frame) => [frame.frameId, frame]));
      onChange(frames.map((frame) => {
        const result = byId.get(frame.id);
        return result ? {
          ...frame,
          observation: result.observation,
          modelText: result.modelText,
          uncertainty: result.uncertainty,
        } : frame;
      }));
      setOverview(data.analysis.overview);
      setGaps(data.analysis.gaps);
      setMessage(`已核对 ${data.analysis.frames.length} 帧；总结与问答只能引用这些真实帧编号`);
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message}；仍可只使用本机 OCR` : "画面核对失败；仍可只使用本机 OCR");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="visual-evidence-studio">
      <header>
        <div><p className="eyebrow">视觉证据底片 · 当前视频</p><h2>字幕说了什么，<em>画面当时显示什么。</em></h2></div>
        <span><strong>{frames.length || "—"}</strong> 帧<small>{stored ? "图片已存浏览器" : frames.length ? "保存总结后持久化" : "等待本机扫描"}</small></span>
      </header>

      {!video.hasVideo ? (
        <div className="visual-audio-only"><i>≈</i><span><strong>这是音频来源</strong><p>没有视频轨道，因此不会伪造关键帧或画面理解。</p></span></div>
      ) : !frames.length && !video.canExtract ? (
        <div className="visual-audio-only"><i>↺</i><span><strong>需要重新选择原文件</strong><p>这条本地媒体已经清理，保存过的字幕仍可使用；重新导入原视频后才能补抽画面。</p></span></div>
      ) : !frames.length ? (
        <div className="visual-scan-empty">
          <div className="visual-film-mark" aria-hidden="true"><i /><i /><i /><b>F</b></div>
          <section><strong>抽取 8 个可回看的画面时间点</strong><p>FFmpeg 在本机按字幕时间分布采样；平台临时视频抽帧后清理，本地文件在保存或转录后清理。</p><span>{ocrReady ? `OCR 就绪 · ${ocrLanguages.map((item) => languageLabels[item] || item).join(" / ")}` : "OCR 未就绪 · 仍可抽取图片"}</span></section>
          <button type="button" onClick={() => void onExtract()} disabled={extracting}>{extracting ? "正在扫描画面…" : "扫描视觉证据"}<b>↘</b></button>
        </div>
      ) : (
        <>
          <div className="visual-contact-sheet" aria-label="视频视觉证据帧">
            {frames.map((frame, index) => (
              <article className={`${frame.id === active?.id ? "active" : ""} ${frame.included ? "included" : "excluded"}`} key={frame.id}>
                <button className="visual-frame-open" type="button" onClick={() => setActiveId(frame.id)} aria-label={`查看 ${frame.timestamp} 画面`}>
                  {frame.imageDataUrl ? <Image unoptimized width={320} height={180} src={frame.imageDataUrl} alt={`${frame.timestamp} 的视频采样画面`} /> : <span>图片未在当前浏览器恢复</span>}
                  <time>{frame.timestamp}</time><i>F{String(index + 1).padStart(2, "0")}</i>
                </button>
                <button className="visual-frame-toggle" type="button" aria-pressed={frame.included} onClick={() => toggleIncluded(frame.id)}>{frame.included ? "✓ 送入 Agent" : "+ 加入资料"}</button>
              </article>
            ))}
          </div>

          <div className="visual-evidence-desk">
            <article className="visual-frame-inspector">
              {active?.imageDataUrl ? <Image unoptimized width={960} height={540} src={active.imageDataUrl} alt={`${active.timestamp} 的放大视频画面`} /> : <div>当前帧图片不可用</div>}
              <footer><span><strong>{active?.timestamp}</strong><small>精确到采样秒</small></span><button type="button" onClick={() => active && toggleIncluded(active.id)}>{active?.included ? "从 Agent 资料排除" : "加入 Agent 资料"}</button></footer>
            </article>
            <section className="visual-reading-ledger">
              <header><span>证据账本</span><strong>{analyzedCount}/{frames.length} 帧已核对</strong></header>
              <div><small>本机 OCR · 自动识别</small><p>{active?.ocrText || "这一帧没有识别到稳定文字。"}</p></div>
              <div className={active?.observation ? "verified" : "pending"}><small>视觉模型 · 画面观察</small><p>{active?.observation || "尚未核对。选择画面后，可交给支持图片的本地模型。"}</p>{active?.modelText && <em>读到文字：{active.modelText}</em>}</div>
              {active?.uncertainty && <div className="uncertain"><small>不确定性</small><p>{active.uncertainty}</p></div>}
              <footer><span>{included.length}/6 帧将送入 Agent</span><button type="button" onClick={() => void analyze()} disabled={analyzing || extracting || !included.length}>{analyzing ? "正在逐帧核对…" : analyzedCount ? "重新核对选中画面" : "让视觉 Agent 核对"}<b>✦</b></button></footer>
            </section>
          </div>
        </>
      )}

      {overview && <div className="visual-overview"><span>仅针对采样帧</span><p>{overview}</p>{gaps.map((gap) => <small key={gap}>! {gap}</small>)}</div>}
      <p className="visual-evidence-message"><i className={extracting || analyzing ? "busy" : ""} />{message}</p>
    </section>
  );
}
