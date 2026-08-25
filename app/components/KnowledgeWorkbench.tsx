"use client";

import { FormEvent, useMemo, useState } from "react";
import { findKnowledgeRelations } from "../features/workbench-core.mjs";
import type { KnowledgeCard, KnowledgeInquiry } from "../features/workbench-core.mjs";

type KnowledgeDraft = Omit<KnowledgeInquiry, "id" | "createdAt">;

type KnowledgeWorkbenchProps = {
  baseURL: string;
  apiKey: string;
  model: string;
  cards: KnowledgeCard[];
  inquiries: KnowledgeInquiry[];
  onNeedSettings: () => void;
  onOpenVideo: () => void;
  onSave: (inquiry: KnowledgeDraft) => void;
  onCreateTask: (task: { title: string; note: string }) => void;
};

const suggestedQuestions = [
  "这些材料共同支持什么结论？",
  "有哪些方法可以立刻用于我的工作？",
  "这些观点之间有什么冲突或资料缺口？",
];

function searchableText(card: KnowledgeCard) {
  return `${card.title} ${card.content} ${card.tags.join(" ")} ${card.sourceTitle}`.toLocaleLowerCase("zh-CN");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function KnowledgeWorkbench({
  baseURL,
  apiKey,
  model,
  cards,
  inquiries,
  onNeedSettings,
  onOpenVideo,
  onSave,
  onCreateTask,
}: KnowledgeWorkbenchProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => cards.slice(-6).map((card) => card.id));
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<KnowledgeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [taskAdded, setTaskAdded] = useState(false);
  const [message, setMessage] = useState(cards.length ? "选择证据卡片，再问一个具体问题" : "先从视频总结保存第一批知识卡片");

  const filteredCards = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (!query) return cards.slice().reverse();
    return cards.filter((card) => searchableText(card).includes(query)).reverse();
  }, [cards, search]);
  const selectedCards = useMemo(
    () => selectedIds.map((id) => cards.find((card) => card.id === id)).filter((card): card is KnowledgeCard => Boolean(card)),
    [cards, selectedIds],
  );
  const sourceCount = useMemo(() => new Set(cards.map((card) => card.sourceUrl)).size, [cards]);
  const tagCount = useMemo(() => new Set(cards.flatMap((card) => card.tags)).size, [cards]);
  const relations = useMemo(() => findKnowledgeRelations(cards, 6), [cards]);

  function toggleCard(id: string) {
    if (!selectedIds.includes(id) && selectedIds.length >= 12) {
      setMessage("一次最多选择 12 张卡片，先取消一张再继续");
      return;
    }
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setAnswer(null);
    setSaved(false);
    setTaskAdded(false);
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const request = question.trim();
    if (request.length < 4) {
      setMessage("把问题写得再具体一点，至少 4 个字符");
      return;
    }
    if (!selectedCards.length) {
      setMessage("至少选择一张知识卡片作为回答证据");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("先连接本地模型；知识卡只会发往你配置的本机服务");
      onNeedSettings();
      return;
    }
    setBusy(true);
    setAnswer(null);
    setSaved(false);
    setTaskAdded(false);
    setMessage(`正在核对 ${selectedCards.length} 张卡片，并检查引用是否有效…`);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "ask-knowledge",
          baseURL,
          apiKey,
          model,
          question: request,
          knowledge: selectedCards,
        }),
      });
      const data = (await response.json()) as { error?: string; answer?: KnowledgeDraft };
      if (!response.ok || !data.answer) throw new Error(data.error || "模型没有返回知识回答");
      setAnswer({ ...data.answer, question: request });
      setMessage(data.answer.answerable
        ? `已用 ${data.answer.sources.length} 条有效引用回答；保存前不会写入记忆`
        : "现有资料不足以完整回答；已把缺口明确列出");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "知识问答失败");
    } finally {
      setBusy(false);
    }
  }

  function saveAnswer() {
    if (!answer || saved) return;
    onSave(answer);
    setSaved(true);
    setMessage("这次问答已保存到本机知识记忆");
  }

  function createSuggestedTask() {
    if (!answer?.suggestedTask || taskAdded) return;
    onCreateTask(answer.suggestedTask);
    setTaskAdded(true);
    setMessage("建议行动已加入今日任务");
  }

  function compareRelation(leftId: string, rightId: string, leftTitle: string, rightTitle: string) {
    setSearch("");
    setSelectedIds([leftId, rightId]);
    setQuestion(`「${leftTitle}」和「${rightTitle}」之间有哪些一致、互补或冲突之处？`);
    setAnswer(null);
    setSaved(false);
    setTaskAdded(false);
    setMessage("已把这条自动关联放到证据桌；检查问题后即可向本地模型求证");
  }

  if (!cards.length) {
    return (
      <section className="knowledge-workbench knowledge-empty">
        <p className="eyebrow">知识库 · 证据优先</p>
        <h1>先留下第一条理解，<br /><em>再让知识彼此连接。</em></h1>
        <div className="knowledge-empty-card">
          <div aria-hidden="true"><i /><i /><i /><span>◇</span></div>
          <section><strong>知识库还没有材料</strong><p>导入一个视频，基于真实字幕生成总结，再明确保存知识卡片。这里不会预置假数据。</p><button onClick={onOpenVideo}>从一个视频开始 <span>↗</span></button></section>
        </div>
      </section>
    );
  }

  return (
    <section className="knowledge-workbench">
      <div className="workspace-heading knowledge-heading">
        <div><p className="eyebrow">知识库 · 多来源核对</p><h1>不是再存一份，<em>而是问出下一步。</em></h1></div>
        <div className="knowledge-stats"><span><strong>{cards.length}</strong> 卡片</span><span><strong>{sourceCount}</strong> 来源</span><span><strong>{tagCount}</strong> 标签</span></div>
      </div>

      <div className="knowledge-evidence-ribbon" aria-label="知识问答流程">
        <span><i>1</i><strong>选证据</strong><small>{selectedCards.length}/12 张</small></span><b />
        <span><i>2</i><strong>问已有理解</strong><small>不调用外部常识</small></span><b />
        <span><i>3</i><strong>保留引用</strong><small>结论可追溯</small></span><b />
        <span><i>4</i><strong>转成行动</strong><small>由你确认</small></span>
      </div>

      <div className="knowledge-grid">
        <aside className="knowledge-shelf">
          <header><div><span>证据架</span><strong>{selectedCards.length} 张已选择</strong></div><button onClick={() => setSelectedIds([])} disabled={!selectedCards.length}>清空</button></header>
          <label className="knowledge-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、标签或内容" aria-label="搜索知识卡片" /></label>
          <div className="knowledge-card-list">
            {filteredCards.map((card) => {
              const selected = selectedIds.includes(card.id);
              return (
                <button className={selected ? "selected" : ""} key={card.id} onClick={() => toggleCard(card.id)} aria-pressed={selected}>
                  <i>{selected ? "✓" : "+"}</i><span><small>{card.sourceTitle}{card.evidenceFrameIds.length ? ` · ${card.evidenceFrameIds.length} 帧证据` : ""}</small><strong>{card.title}</strong><p>{card.content}</p><em>{card.tags.map((tag) => `#${tag}`).join(" ")}</em></span>
                </button>
              );
            })}
            {!filteredCards.length && <div className="knowledge-no-match"><strong>没有匹配的卡片</strong><p>换一个关键词，或清空搜索。</p></div>}
          </div>
        </aside>

        <main className="knowledge-inquiry">
          <header><div><span>Evidence desk</span><h2>只问你已经留下的材料。</h2></div><i>{selectedCards.length}</i></header>
          <div className="question-ideas">{suggestedQuestions.map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}</button>)}</div>
          <form onSubmit={ask}>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 600))} placeholder="例如：这些材料对建立个人学习系统有哪些一致建议？" aria-label="向知识库提问" />
            <footer><span>{question.length}/600 · 只发送选中卡片</span><button disabled={busy || question.trim().length < 4 || !selectedCards.length}>{busy ? "正在核对…" : "从知识中回答"}<b>✦</b></button></footer>
          </form>

          {answer ? (
            <article className={`knowledge-answer ${answer.answerable ? "answerable" : "limited"}`}>
              <header><span>{answer.answerable ? "有证据支持" : "资料仍不足"}</span><strong>{answer.sources.length} 条引用</strong></header>
              <h3>{answer.answer}</h3>
              {answer.keyPoints.length > 0 && <div className="answer-points">{answer.keyPoints.map((point, index) => <p key={point}><i>{String(index + 1).padStart(2, "0")}</i>{point}</p>)}</div>}
              {answer.sources.length > 0 && <div className="answer-sources"><span>引用</span>{answer.sources.map((source) => /^https:\/\//i.test(source.sourceUrl)
                ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" key={source.cardId}><strong>{source.cardTitle}</strong><small>{source.sourceTitle}</small></a>
                : <article key={source.cardId}><strong>{source.cardTitle}</strong><small>{source.sourceTitle} · 本地来源</small></article>)}</div>}
              {answer.gaps.length > 0 && <div className="answer-gaps"><span>还不能确认</span>{answer.gaps.map((gap) => <p key={gap}>! {gap}</p>)}</div>}
              <footer><button className="save-inquiry" onClick={saveAnswer} disabled={saved}>{saved ? "已保存问答" : "保存到知识记忆"}</button>{answer.suggestedTask && <button className="inquiry-task" onClick={createSuggestedTask} disabled={taskAdded}>{taskAdded ? "已加入今日任务" : "加入建议行动 ↗"}</button>}</footer>
            </article>
          ) : (
            <div className="knowledge-answer-placeholder"><span>◇</span><strong>答案会带着来源回来</strong><p>如果卡片不足，Agent 会说明缺什么，不会用标题或常识补齐。</p></div>
          )}
          <p className="knowledge-message"><i className={busy ? "busy" : ""} />{message}</p>
        </main>
      </div>

      {relations.length > 0 && (
        <section className="knowledge-relations">
          <header><div><p className="eyebrow">自动关联 · 跨来源</p><h2>旧理解正在和新材料相遇。</h2></div><span>{relations.length} 条可解释关联</span></header>
          <div>{relations.map((relation) => (
            <button key={relation.id} onClick={() => compareRelation(relation.leftId, relation.rightId, relation.leftTitle, relation.rightTitle)}>
              <span><small>{relation.leftSourceTitle}</small><strong>{relation.leftTitle}</strong></span>
              <i><b>↔</b><em>{relation.sharedTags.length ? relation.sharedTags.map((tag) => `#${tag}`).join(" ") : relation.sharedTerms.slice(0, 2).join(" · ")}</em></i>
              <span><small>{relation.rightSourceTitle}</small><strong>{relation.rightTitle}</strong></span>
              <u>放到证据桌 ↗</u>
            </button>
          ))}</div>
          <p>关联只来自跨来源的共同标签或重复概念；它是待核对线索，不会直接写成结论。</p>
        </section>
      )}

      {inquiries.length > 0 && (
        <section className="inquiry-history">
          <header><div><p className="eyebrow">已保存问答</p><h2>你曾经从这些材料里确认过什么。</h2></div><span>{inquiries.length} 条</span></header>
          <div>{inquiries.slice().reverse().slice(0, 8).map((inquiry) => <article key={inquiry.id}><small>{formatDate(inquiry.createdAt)} · {inquiry.sources.length} 条引用</small><strong>{inquiry.question}</strong><p>{inquiry.answer}</p></article>)}</div>
        </section>
      )}
    </section>
  );
}
