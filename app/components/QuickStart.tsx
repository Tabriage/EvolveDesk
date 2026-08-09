"use client";

import { FormEvent, useState } from "react";

type QuickStartProps = {
  connected: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onCreateTask: (title: string) => void;
};

const startingPoints = [
  "整理今天最重要的工作",
  "处理一个一直拖着的小任务",
  "学习并输出一条新理解",
];

export function QuickStart({ connected, onClose, onOpenSettings, onCreateTask }: QuickStartProps) {
  const [step, setStep] = useState(0);
  const [firstTask, setFirstTask] = useState("");

  function createFirstTask(event: FormEvent) {
    event.preventDefault();
    const title = firstTask.trim();
    if (!title) return;
    onCreateTask(title);
    setStep(1);
  }

  return (
    <div className="onboarding-backdrop" role="presentation">
      <section className="quick-start" role="dialog" aria-modal="true" aria-labelledby="quick-start-title">
        <header className="quick-start-head">
          <div className="onboarding-progress" aria-label={`第 ${step + 1} 步，共 2 步`}>
            {[0, 1].map((index) => <i key={index} className={index <= step ? "active" : ""} />)}
          </div>
          <span>{step + 1} / 2</span>
          <button onClick={onClose} aria-label="暂时关闭起步引导">×</button>
        </header>

        {step === 0 ? (
          <div className="quick-start-step first-task-step">
            <div className="welcome-orbit" aria-hidden="true"><i /><i /><span>从今天开始</span></div>
            <p className="eyebrow">欢迎来到 Evolve Desk</p>
            <h2 id="quick-start-title">先别配置工作台。<br /><em>写下今天唯一要推进的事。</em></h2>
            <p>这一步不需要模型，也不会上传数据。先从真实行动开始；当一类事情反复出现时，再用路线或业务台把它固定下来。</p>
            <form className="starter-task-entry" onSubmit={createFirstTask}>
              <label htmlFor="first-task">今天的第一件事</label>
              <div><input id="first-task" autoFocus value={firstTask} onChange={(event) => setFirstTask(event.target.value)} placeholder="例如：完成工作台首页的可用版本" /><button disabled={!firstTask.trim()}>放到今天 <span>→</span></button></div>
            </form>
            <div className="starter-task-ideas">
              {startingPoints.map((item) => <button key={item} onClick={() => setFirstTask(item)}>{item}</button>)}
            </div>
            <div className="quick-start-actions single-action">
              <button className="text-action" onClick={onClose}>暂时跳过，自己看看</button>
            </div>
          </div>
        ) : (
          <div className="quick-start-step first-ready-step">
            <div className="starter-success" aria-hidden="true"><span>✓</span><i /><i /></div>
            <p className="eyebrow">第一条工作流已经开始</p>
            <h2 id="quick-start-title">现在先把这件事做完。<br /><em>Agent 随时可以来帮忙。</em></h2>
            <div className="first-request"><span>今日焦点</span><p>{firstTask}</p></div>
            <ol className="what-happens-next">
              <li><i>1</i><div><strong>任务留在当前浏览器</strong><small>刷新页面也不会消失。</small></div></li>
              <li><i>2</i><div><strong>想法和链接先扔进收件箱</strong><small>不用马上决定放在哪里。</small></div></li>
              <li><i>3</i><div><strong>需要时再让 Agent 整理</strong><small>动作清单必须由你确认后执行。</small></div></li>
              <li><i>4</i><div><strong>重复流程再做成个人业务台</strong><small>从内容、学习或订单模板开始，不必自己设计系统。</small></div></li>
            </ol>
            <div className={`connection-check ${connected ? "ready" : ""}`}>
              <i>{connected ? "✓" : "可选"}</i>
              <div><strong>{connected ? "本地模型已经连接" : "稍后连接本地模型"}</strong><small>{connected ? "右侧行动 Agent 已可使用" : "不影响任务、收件箱和习惯打卡"}</small></div>
              {!connected && <button onClick={onOpenSettings}>连接 Agent</button>}
            </div>
            <div className="quick-start-actions">
              <button className="primary-action enter-workbench" onClick={onClose}>进入今日工作台 <span>↗</span></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
