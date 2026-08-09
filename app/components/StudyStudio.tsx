"use client";

import { FormEvent, useMemo, useState } from "react";
import type {
  KnowledgeCard,
  StudyAttempt,
  StudyCard,
  StudyCardDraft,
  StudyRating,
} from "../features/workbench-core.mjs";

type StudyStudioProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  knowledge: KnowledgeCard[];
  cards: StudyCard[];
  attempts: StudyAttempt[];
  onNeedSettings: () => void;
  onOpenKnowledge: () => void;
  onSaveCards: (cards: StudyCardDraft[], actor?: "agent" | "human") => void;
  onRate: (cardId: string, rating: StudyRating, selectedAnswer?: string) => void;
  onRemove: (cardId: string) => void;
  onToggleSuspended: (cardId: string) => void;
  onCreateTask: (cardIds: string[]) => void;
};

type StudioMode = "review" | "build" | "library";
type DraftPack = { title: string; cards: StudyCardDraft[] };
type ManualDraft = {
  kind: StudyCardDraft["kind"];
  prompt: string;
  answer: string;
  explanation: string;
  optionsText: string;
  tagsText: string;
};

const emptyManual: ManualDraft = {
  kind: "recall",
  prompt: "",
  answer: "",
  explanation: "",
  optionsText: "",
  tagsText: "",
};

const ratingLabels: Array<{ rating: StudyRating; label: string; tone: string }> = [
  { rating: "again", label: "忘了", tone: "again" },
  { rating: "hard", label: "吃力", tone: "hard" },
  { rating: "good", label: "记住", tone: "good" },
  { rating: "easy", label: "很稳", tone: "easy" },
];

function localDayKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDue(card: StudyCard, now = new Date()) {
  return !card.suspended && new Date(card.dueAt).getTime() <= now.getTime();
}

function formatDue(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.getTime() <= now.getTime()) return "现在到期";
  const sameDay = localDayKey(date) === localDayKey(now);
  return new Intl.DateTimeFormat("zh-CN", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "numeric", day: "numeric" }).format(date);
}

function nextIntervalLabel(card: StudyCard, rating: StudyRating) {
  if (rating === "again") return "10 分钟";
  if (rating === "hard") return `${card.reviewCount === 0 ? 1 : Math.max(1, Math.ceil(Math.max(1, card.intervalDays) * 1.2))} 天`;
  if (rating === "good") return `${card.reviewCount === 0 ? 1 : card.reviewCount === 1 ? 3 : Math.max(1, Math.round(Math.max(1, card.intervalDays) * card.easeFactor))} 天`;
  return `${card.reviewCount === 0 ? 4 : Math.max(2, Math.round(Math.max(1, card.intervalDays) * Math.min(3, card.easeFactor + 0.15) * 1.3))} 天`;
}

function sourceLabel(card: StudyCard) {
  if (!card.sources.length) return "手动卡片";
  return card.sources.map((source) => source.cardTitle).join(" · ");
}

export function StudyStudio({
  baseURL,
  apiKey,
  model,
  knowledge,
  cards,
  attempts,
  onNeedSettings,
  onOpenKnowledge,
  onSaveCards,
  onRate,
  onRemove,
  onToggleSuspended,
  onCreateTask,
}: StudyStudioProps) {
  const [mode, setMode] = useState<StudioMode>("review");
  const [selectedKnowledgeIds, setSelectedKnowledgeIds] = useState<string[]>(() => knowledge.slice(-4).map((card) => card.id));
  const [focus, setFocus] = useState("");
  const [draftPack, setDraftPack] = useState<DraftPack | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<ManualDraft>(emptyManual);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("新卡会立即进入复习队列；每次评分都会更新下一次出现时间");
  const [queue, setQueue] = useState<string[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionCompleted, setSessionCompleted] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "due" | "suspended">("all");

  const now = new Date();
  const dueCards = cards.filter((card) => isDue(card, now)).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const selectedKnowledge = useMemo(() => selectedKnowledgeIds.map((id) => knowledge.find((card) => card.id === id)).filter((card): card is KnowledgeCard => Boolean(card)), [knowledge, selectedKnowledgeIds]);
  const currentCard = queue.length ? cards.find((card) => card.id === queue[0]) || null : null;
  const todayAttempts = attempts.filter((attempt) => localDayKey(new Date(attempt.reviewedAt)) === localDayKey(now));
  const stableCards = cards.filter((card) => !card.suspended && card.reviewCount >= 3 && card.intervalDays >= 21).length;
  const memoryTrack = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now);
    day.setHours(23, 59, 59, 999);
    day.setDate(day.getDate() + index);
    const count = cards.filter((card) => !card.suspended && new Date(card.dueAt).getTime() <= day.getTime() && (index === 0 || new Date(card.dueAt).getTime() > new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, 23, 59, 59, 999).getTime())).length;
    return { label: index === 0 ? "今天" : index === 1 ? "明天" : `${day.getMonth() + 1}/${day.getDate()}`, count };
  });
  const libraryCards = cards.filter((card) => libraryFilter === "all" ? true : libraryFilter === "due" ? isDue(card, now) : card.suspended);

  function toggleKnowledge(id: string) {
    if (!selectedKnowledgeIds.includes(id) && selectedKnowledgeIds.length >= 12) {
      setMessage("一次最多选择 12 张知识卡片");
      return;
    }
    setSelectedKnowledgeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setDraftPack(null);
  }

  async function generateCards(event: FormEvent) {
    event.preventDefault();
    if (!selectedKnowledge.length) {
      setMessage("至少选择一张知识卡片作为制卡证据");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；只会发送你选中的知识卡片");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setDraftPack(null);
    setMessage(`正在把 ${selectedKnowledge.length} 张知识卡变成可核对的主动回忆题…`);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "generate-study-cards",
          baseURL,
          apiKey,
          model,
          focus: focus.trim(),
          knowledge: selectedKnowledge,
        }),
      });
      const data = (await response.json()) as { error?: string; pack?: DraftPack };
      if (!response.ok || !data.pack) throw new Error(data.error || "模型没有返回复习卡");
      setDraftPack(data.pack);
      setMessage(`生成了 ${data.pack.cards.length} 张草案；你可以逐张修改，保存前不会进入复习队列`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成复习卡失败");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(index: number, patch: Partial<StudyCardDraft>) {
    setDraftPack((current) => current ? { ...current, cards: current.cards.map((card, cardIndex) => cardIndex === index ? { ...card, ...patch } : card) } : current);
  }

  function saveDraftPack() {
    if (!draftPack) return;
    const invalid = draftPack.cards.find((card) => !card.prompt.trim() || !card.answer.trim()
      || (card.kind === "multiple_choice" && (card.options.length < 3 || !card.options.includes(card.answer))));
    if (invalid) {
      setMessage("每张卡都要有题目和答案；选择题至少 3 个选项，且答案必须与其中一个选项完全一致");
      return;
    }
    onSaveCards(draftPack.cards, "agent");
    setDraftPack(null);
    setMode("review");
    setMessage(`已保存 ${draftPack.cards.length} 张复习卡，它们现在已经到期`);
  }

  function saveManualCard(event: FormEvent) {
    event.preventDefault();
    const options = manual.optionsText.split("\n").map((item) => item.trim()).filter(Boolean);
    if (!manual.prompt.trim() || !manual.answer.trim()) {
      setMessage("先写清题目和答案");
      return;
    }
    if (manual.kind === "multiple_choice" && (options.length < 3 || !options.includes(manual.answer.trim()))) {
      setMessage("选择题至少需要 3 个选项，并且答案必须与其中一个选项完全一致");
      return;
    }
    onSaveCards([{
      kind: manual.kind,
      prompt: manual.prompt.trim(),
      answer: manual.answer.trim(),
      explanation: manual.explanation.trim() || "由用户手动建立，尚未补充解释。",
      options: manual.kind === "multiple_choice" ? options : [],
      tags: manual.tagsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 6),
      sources: selectedKnowledge.map((card) => ({ cardId: card.id, cardTitle: card.title, sourceTitle: card.sourceTitle, sourceUrl: card.sourceUrl })),
    }], "human");
    setManual(emptyManual);
    setManualOpen(false);
    setMode("review");
    setMessage("手动卡片已进入复习队列");
  }

  function startSession() {
    const ids = dueCards.slice(0, 20).map((card) => card.id);
    if (!ids.length) {
      setMessage("现在没有到期卡片");
      return;
    }
    setQueue(ids);
    setSessionTotal(ids.length);
    setSessionCompleted(0);
    setSessionDone(false);
    setRevealed(false);
    setSelectedAnswer("");
    setMessage(`开始复习 ${ids.length} 张到期卡片`);
  }

  function chooseAnswer(answer: string) {
    if (!currentCard || revealed) return;
    setSelectedAnswer(answer);
    setRevealed(true);
  }

  function rate(rating: StudyRating) {
    if (!currentCard || !revealed) return;
    onRate(currentCard.id, rating, selectedAnswer);
    const finished = queue.length === 1;
    setQueue((current) => current.slice(1));
    setSessionCompleted((count) => count + 1);
    setSessionDone(finished);
    setRevealed(false);
    setSelectedAnswer("");
    setMessage(finished ? "本轮复习完成；下一次出现时间已按你的评分更新" : "已记录评分，继续下一张");
  }

  function removeCard(card: StudyCard) {
    if (!window.confirm(`移除「${card.prompt}」及其复习记录？`)) return;
    onRemove(card.id);
    setQueue((current) => current.filter((id) => id !== card.id));
    setMessage("复习卡及其本地记录已移除");
  }

  return (
    <section className="study-studio">
      <div className="workspace-heading study-heading">
        <div><p className="eyebrow">记忆复习 · 主动回忆</p><h1>收藏不是学会。<em>今天到期的，先自己想一遍。</em></h1></div>
        <div className="study-scoreboard"><span><strong>{dueCards.length}</strong> 到期</span><span><strong>{todayAttempts.length}</strong> 今日复习</span><span><strong>{stableCards}</strong> 间隔 ≥21天</span></div>
      </div>

      <div className="memory-track" aria-label="未来七天复习轨道">
        <div className="memory-track-label"><span>MEMORY TRACK</span><strong>未来 7 天</strong><small>按下一次出现时间排队</small></div>
        {memoryTrack.map((day, index) => <div className={`memory-track-day ${day.count ? "has-cards" : ""}`} key={day.label}><i style={{ height: `${Math.min(100, 18 + day.count * 16)}%` }} /><strong>{day.count}</strong><span>{day.label}</span><small>{index === 0 ? "先清这里" : "计划出现"}</small></div>)}
      </div>

      <nav className="study-modes" aria-label="记忆复习模式">
        <button className={mode === "review" ? "active" : ""} onClick={() => setMode("review")}><i>↺</i><span><strong>今日复习</strong><small>{dueCards.length ? `${dueCards.length} 张等待回忆` : "现在没有到期卡"}</small></span></button>
        <button className={mode === "build" ? "active" : ""} onClick={() => setMode("build")}><i>＋</i><span><strong>从知识制卡</strong><small>闪卡与选择题</small></span></button>
        <button className={mode === "library" ? "active" : ""} onClick={() => setMode("library")}><i>▤</i><span><strong>卡片库</strong><small>{cards.length} 张本地卡片</small></span></button>
      </nav>

      {mode === "review" && (
        <div className="study-review-layout">
          <main className="study-session">
            {!currentCard && !sessionDone && (
              <div className={`study-session-start ${dueCards.length ? "has-due" : "is-clear"}`}>
                <span className="session-seal">{dueCards.length ? dueCards.length : "✓"}</span>
                <p>{dueCards.length ? "今天的到期队列" : "队列已清空"}</p>
                <h2>{dueCards.length ? `先完成 ${Math.min(20, dueCards.length)} 张，别让收藏只停在看过。` : "现在没有需要追赶的卡片。"}</h2>
                <p>{dueCards.length ? "先尝试回答，再翻面核对。评分只影响下一次出现时间，不会替你宣称掌握。" : "可以从知识库生成新卡，或等下一张按计划出现。"}</p>
                <div><button className="study-primary" onClick={dueCards.length ? startSession : () => setMode("build")}>{dueCards.length ? "开始主动回忆 →" : "从知识制卡 →"}</button>{dueCards.length > 0 && <button className="study-secondary" onClick={() => onCreateTask(dueCards.slice(0, 20).map((card) => card.id))}>加入今日任务</button>}</div>
              </div>
            )}

            {sessionDone && !currentCard && (
              <div className="study-session-complete"><span>✓</span><p>本轮完成</p><h2>{sessionCompleted} 张卡片已经重新排入记忆轨道。</h2><button onClick={() => { setSessionDone(false); setMode("library"); }}>查看下一次出现时间 →</button></div>
            )}

            {currentCard && (
              <article className={`recall-card ${revealed ? "revealed" : ""}`}>
                <header><span>{currentCard.kind === "multiple_choice" ? "选择题" : "主动回忆"}</span><strong>{sessionCompleted + 1} / {sessionTotal}</strong><button onClick={() => { setQueue([]); setMessage("本轮已暂停，未评分的卡片保持原到期时间"); }}>结束本轮</button></header>
                <div className="recall-progress"><i style={{ width: `${Math.round((sessionCompleted / Math.max(1, sessionTotal)) * 100)}%` }} /></div>
                <section className="recall-front"><small>{sourceLabel(currentCard)}</small><h2>{currentCard.prompt}</h2>
                  {currentCard.kind === "multiple_choice" ? <div className="quiz-options">{currentCard.options.map((option, index) => <button className={revealed ? option === currentCard.answer ? "correct" : option === selectedAnswer ? "wrong" : "muted" : ""} key={option} onClick={() => chooseAnswer(option)} disabled={revealed}><i>{String.fromCharCode(65 + index)}</i><span>{option}</span></button>)}</div> : !revealed && <button className="reveal-answer" onClick={() => setRevealed(true)}>显示答案 <span>先想再翻面</span></button>}
                </section>
                {revealed && <section className="recall-back"><span>{currentCard.kind === "multiple_choice" ? selectedAnswer === currentCard.answer ? "回答正确" : "答案核对" : "参考答案"}</span><h3>{currentCard.answer}</h3><p>{currentCard.explanation}</p>{currentCard.sources.length > 0 && <div>{currentCard.sources.map((source) => /^https:\/\//i.test(source.sourceUrl) ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" key={source.cardId}>{source.cardTitle} ↗</a> : <span key={source.cardId}>{source.cardTitle}</span>)}</div>}</section>}
                {revealed && <footer className="rating-row">{ratingLabels.map((item) => <button className={item.tone} key={item.rating} onClick={() => rate(item.rating)}><strong>{item.label}</strong><small>{nextIntervalLabel(currentCard, item.rating)}</small></button>)}</footer>}
              </article>
            )}
          </main>

          <aside className="study-session-ledger">
            <header><span>今日记忆账</span><strong>{todayAttempts.length} 次</strong></header>
            <div className="rating-summary">{ratingLabels.map((item) => <span key={item.rating}><i className={item.tone} />{item.label}<strong>{todayAttempts.filter((attempt) => attempt.rating === item.rating).length}</strong></span>)}</div>
            <p>一次答对只是一条复习记录，不代表长期掌握。间隔会根据你主动选择的难度逐步拉长或缩短。</p>
            {todayAttempts.slice(-6).reverse().map((attempt) => <article key={attempt.id}><small>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(attempt.reviewedAt))}</small><strong>{attempt.cardPrompt}</strong><span>{ratingLabels.find((item) => item.rating === attempt.rating)?.label} · 下次 {attempt.nextIntervalDays ? `${attempt.nextIntervalDays} 天` : "10 分钟"}</span></article>)}
          </aside>
        </div>
      )}

      {mode === "build" && (
        <div className="study-builder">
          <aside className="study-source-shelf">
            <header><div><span>制卡证据</span><strong>{selectedKnowledge.length}/12 张</strong></div><button onClick={onOpenKnowledge}>打开知识库 ↗</button></header>
            {knowledge.length ? <div>{knowledge.slice().reverse().map((card) => { const selected = selectedKnowledgeIds.includes(card.id); return <button className={selected ? "selected" : ""} key={card.id} onClick={() => toggleKnowledge(card.id)} aria-pressed={selected}><i>{selected ? "✓" : "+"}</i><span><small>{card.sourceTitle}</small><strong>{card.title}</strong><p>{card.content}</p></span></button>; })}</div> : <section><strong>还没有知识卡</strong><p>先从视频字幕形成真实总结，再回来制卡。</p><button onClick={onOpenKnowledge}>从知识库开始</button></section>}
          </aside>

          <main className="study-draft-desk">
            <header><div><p className="eyebrow">Agent 制卡台</p><h2>每一题都必须能回到来源。</h2></div><button onClick={() => setManualOpen((open) => !open)}>{manualOpen ? "收起手动卡" : "自己写一张"}</button></header>
            <form className="study-generate-form" onSubmit={generateCards}><textarea value={focus} onChange={(event) => setFocus(event.target.value.slice(0, 500))} placeholder="可选：这次更想记住什么？例如：方法的适用条件与常见误区" aria-label="复习卡制卡重点" /><footer><span>只发送所选知识卡 · 生成后仍需确认</span><button disabled={busy || !selectedKnowledge.length}>{busy ? "正在制卡…" : "生成闪卡与测验 ✦"}</button></footer></form>

            {manualOpen && <form className="manual-study-card" onSubmit={saveManualCard}><header><span>手动卡 · 不需要模型</span><small>{selectedKnowledge.length ? `引用 ${selectedKnowledge.length} 张所选知识卡` : "无来源手动卡"}</small></header><label>卡片类型<select value={manual.kind} onChange={(event) => setManual((current) => ({ ...current, kind: event.target.value as "recall" | "multiple_choice" }))}><option value="recall">主动回忆</option><option value="multiple_choice">选择题</option></select></label><label>题目<textarea value={manual.prompt} onChange={(event) => setManual((current) => ({ ...current, prompt: event.target.value.slice(0, 500) }))} placeholder="只问一个明确知识点" /></label><label>答案<textarea value={manual.answer} onChange={(event) => setManual((current) => ({ ...current, answer: event.target.value.slice(0, 1_200) }))} placeholder="短而完整的答案" /></label>{manual.kind === "multiple_choice" && <label>选项<textarea value={manual.optionsText} onChange={(event) => setManual((current) => ({ ...current, optionsText: event.target.value }))} placeholder={'每行一个选项，至少 3 个\n答案必须与某一行完全一致'} /></label>}<label>解释<textarea value={manual.explanation} onChange={(event) => setManual((current) => ({ ...current, explanation: event.target.value.slice(0, 1_200) }))} placeholder="为什么是这个答案？" /></label><label>标签<input value={manual.tagsText} onChange={(event) => setManual((current) => ({ ...current, tagsText: event.target.value }))} placeholder="学习系统, 主动回忆" /></label><footer><button type="button" onClick={() => setManualOpen(false)}>取消</button><button disabled={!manual.prompt.trim() || !manual.answer.trim()}>保存并立即进入复习 →</button></footer></form>}

            {draftPack ? <section className="study-draft-pack"><header><div><span>待确认卡组</span><h3>{draftPack.title}</h3></div><strong>{draftPack.cards.length} 张</strong></header>{draftPack.cards.map((card, index) => <article key={`${card.prompt}-${index}`}><header><i>{String(index + 1).padStart(2, "0")}</i><select value={card.kind} onChange={(event) => updateDraft(index, { kind: event.target.value as StudyCardDraft["kind"], options: event.target.value === "recall" ? [] : card.options })}><option value="recall">主动回忆</option><option value="multiple_choice">选择题</option></select><button onClick={() => setDraftPack((current) => current ? { ...current, cards: current.cards.filter((_, cardIndex) => cardIndex !== index) } : current)} aria-label={`移除第 ${index + 1} 张草案`}>×</button></header><label>题目<textarea value={card.prompt} onChange={(event) => updateDraft(index, { prompt: event.target.value.slice(0, 500) })} /></label><label>答案<textarea value={card.answer} onChange={(event) => updateDraft(index, { answer: event.target.value.slice(0, 1_200) })} /></label>{card.kind === "multiple_choice" && <label>选项<textarea value={card.options.join("\n")} onChange={(event) => updateDraft(index, { options: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 5) })} /></label>}<label>解释<textarea value={card.explanation} onChange={(event) => updateDraft(index, { explanation: event.target.value.slice(0, 1_200) })} /></label><footer><span>{card.sources.map((source) => source.cardTitle).join(" · ")}</span><input value={card.tags.join(", ")} onChange={(event) => updateDraft(index, { tags: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 6) })} aria-label={`第 ${index + 1} 张卡片标签`} /></footer></article>)}<div className="study-pack-actions"><button onClick={() => { setDraftPack(null); setMessage("卡组草案已搁置，没有写入复习队列"); }}>搁置草案</button><button onClick={saveDraftPack} disabled={!draftPack.cards.length}>保存 {draftPack.cards.length} 张卡片 →</button></div></section> : !manualOpen && <div className="study-builder-placeholder"><span>◈</span><strong>先选证据，再生成草案</strong><p>Agent 会混合主动回忆与选择题；每张卡都保留真实知识来源，保存前可以修改或删除。</p></div>}
            <p className="study-message"><i className={busy ? "busy" : ""} />{message}</p>
          </main>
        </div>
      )}

      {mode === "library" && (
        <section className="study-library">
          <header><div><p className="eyebrow">本地卡片库</p><h2>看见卡片为什么出现、下一次什么时候回来。</h2></div><div>{(["all", "due", "suspended"] as const).map((filter) => <button className={libraryFilter === filter ? "active" : ""} key={filter} onClick={() => setLibraryFilter(filter)}>{filter === "all" ? "全部" : filter === "due" ? "已到期" : "已暂停"}</button>)}</div></header>
          {libraryCards.length ? <div className="study-library-grid">{libraryCards.slice().reverse().map((card) => <article className={card.suspended ? "suspended" : ""} key={card.id}><header><span>{card.kind === "multiple_choice" ? "选择题" : "主动回忆"}</span><small>{card.reviewCount} 次复习</small></header><h3>{card.prompt}</h3><p>{card.answer}</p><div className="card-schedule"><span><small>下次出现</small><strong>{card.suspended ? "已暂停" : formatDue(card.dueAt)}</strong></span><span><small>当前间隔</small><strong>{card.intervalDays ? `${card.intervalDays} 天` : "新卡"}</strong></span><span><small>遗忘记录</small><strong>{card.lapseCount}</strong></span></div><footer><span>{sourceLabel(card)}</span><div><button onClick={() => onToggleSuspended(card.id)}>{card.suspended ? "恢复" : "暂停"}</button><button onClick={() => removeCard(card)}>移除</button></div></footer></article>)}</div> : <div className="study-library-empty"><span>▤</span><strong>{cards.length ? "这里没有符合筛选的卡片" : "卡片库还是空的"}</strong><p>{cards.length ? "切换筛选查看其他卡片。" : "从一张真实知识卡开始，生成可持续复习的问题。"}</p><button onClick={() => setMode("build")}>开始制卡 →</button></div>}
        </section>
      )}
    </section>
  );
}
