"use client";

import { useMemo, useState } from "react";
import { buildWeeklySnapshot } from "../features/workbench-core.mjs";
import type { WeeklyReview as WeeklyReviewRecord, WorkbenchState } from "../features/workbench-core.mjs";

type ReviewDraft = Omit<WeeklyReviewRecord, "id" | "createdAt">;

type WeeklyReviewProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  state: WorkbenchState;
  reviews: WeeklyReviewRecord[];
  onNeedSettings: () => void;
  onSave: (review: ReviewDraft) => void;
  onCreateTasks: (tasks: Array<{ title: string; note: string }>) => void;
};

function shiftedWeek(offset: number) {
  const value = new Date();
  value.setDate(value.getDate() + offset * 7);
  return value;
}

function formatSavedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function WeeklyReview({
  baseURL,
  apiKey,
  model,
  state,
  reviews,
  onNeedSettings,
  onSave,
  onCreateTasks,
}: WeeklyReviewProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tasksAdded, setTasksAdded] = useState(false);
  const [message, setMessage] = useState("先看事实轨迹，再让 Agent 帮你提炼一个方向");
  const snapshot = useMemo(() => buildWeeklySnapshot(state, shiftedWeek(weekOffset)), [state, weekOffset]);
  const persisted = reviews.find((review) => review.weekKey === snapshot.weekKey) || null;
  const review = (draft?.weekKey === snapshot.weekKey ? draft : null) || persisted;
  const maxDayTotal = Math.max(1, ...snapshot.days.map((day) => day.total));
  const pendingInbox = snapshot.capturedItems.filter((item) => item.status === "new").length;

  function moveWeek(delta: number) {
    setWeekOffset((value) => Math.max(-11, Math.min(0, value + delta)));
    setDraft(null);
    setSaved(false);
    setTasksAdded(false);
    setMessage("先看事实轨迹，再让 Agent 帮你提炼一个方向");
  }

  async function generateReview() {
    if (!snapshot.hasEvidence) {
      setMessage("这一周还没有可回顾的真实记录；先完成、捕捉或整理一件事");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；周度快照只会发往你配置的本机服务");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setSaved(false);
    setTasksAdded(false);
    setMessage("正在核对完成、积压与知识产物，不会补写工作台之外的经历…");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "weekly-review", baseURL, apiKey, model, weeklySnapshot: snapshot }),
      });
      const data = (await response.json()) as {
        error?: string;
        review?: Omit<ReviewDraft, "weekKey" | "periodLabel" | "sourceStats">;
      };
      if (!response.ok || !data.review) throw new Error(data.error || "模型没有返回周回顾");
      setDraft({
        ...data.review,
        weekKey: snapshot.weekKey,
        periodLabel: snapshot.periodLabel,
        sourceStats: snapshot.sourceStats,
      });
      setMessage("回顾已生成但还未写入本地记忆；请先核对，再决定是否保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "周回顾生成失败");
    } finally {
      setBusy(false);
    }
  }

  function saveReview(addTasks: boolean) {
    if (!review) return;
    if (!saved) onSave({
      weekKey: review.weekKey,
      periodLabel: review.periodLabel,
      headline: review.headline,
      summary: review.summary,
      wins: review.wins,
      friction: review.friction,
      knowledgeConnections: review.knowledgeConnections,
      nextWeekFocus: review.nextWeekFocus,
      suggestedActions: review.suggestedActions,
      sourceStats: review.sourceStats,
    });
    setSaved(true);
    if (addTasks && !tasksAdded) {
      onCreateTasks(review.suggestedActions);
      setTasksAdded(true);
      setMessage(`回顾已保存，并把 ${review.suggestedActions.length} 个建议加入任务`);
    } else {
      setMessage("这份回顾已保存到本机记忆");
    }
  }

  return (
    <section className="weekly-review">
      <div className="workspace-heading review-heading">
        <div><p className="eyebrow">周回顾 · {snapshot.periodLabel}</p><h1>看清真实轨迹，<em>只带走一个方向。</em></h1></div>
        <div className="week-switcher" aria-label="选择回顾周">
          <button onClick={() => moveWeek(-1)} aria-label="上一周">←</button>
          <span>{weekOffset === 0 ? "本周" : `${Math.abs(weekOffset)} 周前`}</span>
          <button onClick={() => moveWeek(1)} disabled={weekOffset === 0} aria-label="下一周">→</button>
        </div>
      </div>

      <article className="week-trace">
        <header>
          <div><span>WEEK TRACE / {snapshot.weekKey}</span><h2>这一周留下了什么痕迹</h2></div>
          <div className="trace-legend"><span><i className="work" />推进</span><span><i className="capture" />输入与节律</span><span><i className="knowledge" />知识</span><span><i className="study" />复习</span><span><i className="creator" />创作</span></div>
        </header>
        <ol>
          {snapshot.days.map((day) => {
            const work = day.tasksCreated + day.tasksCompleted;
            const capture = day.inboxCaptured + day.habitCheckins;
            const knowledge = day.videos + day.visualFrames + day.knowledgeCards + day.inquiries + day.learningTopics;
            const creator = day.creatorIdeas + day.creatorReviews;
            const study = day.studyCardsCreated + day.studyReviews;
            return (
              <li key={day.key} aria-label={`${day.dateLabel}共 ${day.total} 条记录`}>
                <strong>{String(day.total).padStart(2, "0")}</strong>
                <div className="trace-bar"><i style={{ height: day.total ? `${Math.max(12, Math.round((day.total / maxDayTotal) * 100))}%` : "3%" }}>
                  {knowledge > 0 && <span className="knowledge" style={{ flex: knowledge }} />}
                  {creator > 0 && <span className="creator" style={{ flex: creator }} />}
                  {study > 0 && <span className="study" style={{ flex: study }} />}
                  {capture > 0 && <span className="capture" style={{ flex: capture }} />}
                  {work > 0 && <span className="work" style={{ flex: work }} />}
                </i></div>
                <b>周{day.label}</b><small>{day.dateLabel}</small>
              </li>
            );
          })}
        </ol>
        <footer>
          <span><strong>{snapshot.sourceStats.completedTasks}</strong>完成</span>
          <span><strong>{snapshot.sourceStats.habitCheckins}</strong>打卡</span>
          <span><strong>{snapshot.sourceStats.capturedItems}</strong>输入</span>
          <span><strong>{snapshot.sourceStats.visualFrames}</strong>画面帧</span>
          <span><strong>{snapshot.sourceStats.knowledgeCards}</strong>知识卡</span>
          <span><strong>{snapshot.sourceStats.knowledgeInquiries}</strong>次求证</span>
          <span><strong>{snapshot.sourceStats.learningTopics}</strong>学习专题</span>
          <span><strong>{snapshot.sourceStats.creatorIdeas}</strong>创作选题</span>
          <span><strong>{snapshot.sourceStats.creatorReviews}</strong>内容复盘</span>
          <span><strong>{snapshot.sourceStats.studyCardsCreated}</strong>复习卡</span>
          <span><strong>{snapshot.sourceStats.studyReviews}</strong>次复习</span>
        </footer>
      </article>

      <div className="review-grid">
        <section className="review-evidence">
          <header><div><span>FACTS, NOT MOOD</span><h2>可核对的事实</h2></div><b>{snapshot.hasEvidence ? "有记录" : "等待记录"}</b></header>
          <div className="evidence-ledger">
            <article><i>✓</i><div><strong>实际完成</strong><p>{snapshot.completedTasks.length ? snapshot.completedTasks.map((task) => task.title).join(" · ") : "还没有完成记录"}</p></div></article>
            <article><i>↘</i><div><strong>输入去向</strong><p>{snapshot.sourceStats.capturedItems} 条输入，{snapshot.sourceStats.plannedItems} 条已安排，{pendingInbox} 条仍待整理</p></div></article>
            <article><i>◇</i><div><strong>形成知识</strong><p>{snapshot.sourceStats.videos} 个视频 · {snapshot.sourceStats.visualFrames} 帧画面 · {snapshot.sourceStats.knowledgeCards} 张卡片 · {snapshot.sourceStats.learningTopics} 个专题 · {snapshot.sourceStats.knowledgeInquiries} 次有据问答</p></div></article>
            <article><i>◒</i><div><strong>创作闭环</strong><p>{snapshot.sourceStats.creatorIdeas} 个选题 · {snapshot.sourceStats.creatorReviews} 次发布复盘</p></div></article>
            <article><i>◈</i><div><strong>主动回忆</strong><p>{snapshot.sourceStats.studyCardsCreated} 张新复习卡 · {snapshot.sourceStats.studyReviews} 次真实复习</p></div></article>
          </div>
          <div className="open-loops">
            <span>仍然打开的循环 · {snapshot.openTasks.length}</span>
            {snapshot.openTasks.length ? snapshot.openTasks.slice().reverse().map((task) => <p key={task.id}><i />{task.title}<small>{task.priority === "high" ? "高优先" : "待推进"}</small></p>) : <p className="no-loop">没有未完成任务</p>}
          </div>
        </section>

        <section className={`review-agent ${review ? "has-review" : ""}`}>
          <header><div><span>LOCAL REVIEW AGENT</span><h2>{persisted && !draft ? "已保存的判断" : "从证据中提炼判断"}</h2></div><i>✦</i></header>
          {review ? (
            <article className="review-output">
              <span>{review.headline}</span>
              <h3>{review.summary}</h3>
              <div className="review-columns">
                <section><strong>确实推进</strong>{review.wins.map((item) => <p key={item}>＋ {item}</p>)}</section>
                <section><strong>可能的摩擦</strong>{review.friction.length ? review.friction.map((item) => <p key={item}>△ {item}</p>) : <p>没有足够证据判断摩擦</p>}</section>
              </div>
              {review.knowledgeConnections.length > 0 && <div className="review-connections"><strong>知识连接</strong>{review.knowledgeConnections.map((item) => <p key={item}>◇ {item}</p>)}</div>}
              <div className="next-focus"><span>NEXT / 01</span><strong>{review.nextWeekFocus}</strong></div>
              <div className="review-actions"><span>建议动作</span>{review.suggestedActions.map((action, index) => <p key={`${action.title}-${index}`}><i>{index + 1}</i><span><strong>{action.title}</strong><small>{action.note}</small></span></p>)}</div>
              <footer>
                <button className="review-refresh" onClick={generateReview} disabled={busy}>{busy ? "正在重看…" : "重新生成"}</button>
                <button onClick={() => saveReview(false)} disabled={saved}>{saved || (persisted && !draft) ? "已保存" : "保存回顾"}</button>
                <button className="review-plan" onClick={() => saveReview(true)} disabled={tasksAdded}>{tasksAdded ? "已加入任务" : "保存并安排 ↗"}</button>
              </footer>
            </article>
          ) : (
            <div className="review-agent-empty">
              <div><i /><i /><span>↺</span></div>
              <strong>{snapshot.hasEvidence ? "事实已经准备好" : "这一周还很安静"}</strong>
              <p>{snapshot.hasEvidence ? "Agent 只读取上面的周度快照，区分真实完成、可能摩擦与资料缺口。" : "完成任务、打卡或整理输入后，这里才会生成回顾。"}</p>
              <button onClick={generateReview} disabled={busy || !snapshot.hasEvidence}>{busy ? "正在核对证据…" : "生成证据回顾"}</button>
            </div>
          )}
          <p className="review-message"><i className={busy ? "busy" : ""} />{message}</p>
        </section>
      </div>

      {reviews.length > 0 && (
        <section className="review-history">
          <header><div><p className="eyebrow">回顾记忆</p><h2>方向如何一周一周发生变化。</h2></div><span>{reviews.length} 周</span></header>
          <div>{reviews.slice().reverse().slice(0, 6).map((item) => <article key={item.id}><small>{item.periodLabel} · {formatSavedAt(item.createdAt)}</small><strong>{item.headline}</strong><p>{item.nextWeekFocus}</p></article>)}</div>
        </section>
      )}
    </section>
  );
}
