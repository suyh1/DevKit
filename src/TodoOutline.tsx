import { useState } from 'react';
import { CalendarDays, GitBranch, ListTree, Play } from 'lucide-react';
import { isTodoDate, todoReferences, todoTaskTitle } from '../shared/todo-text.mjs';
import type { TodoDependency, TodoModel, TodoTask } from '../shared/todo-text.mjs';

const dependencyLabels: Record<TodoDependency['state'], string> = {
  open: '前置未完成', done: '前置已完成', cancelled: '前置已取消', self: '引用了当前任务', duplicate: '前置编号重复', missing: '找不到前置任务',
};

export function needsTodoFollowUp(task: TodoTask, today: string) {
  const review = task.waiting?.review;
  return !task.archived && task.status === 'open' && !!review && isTodoDate(review) && review <= today;
}

function hasTag(task: TodoTask, value: string) {
  const label = value.trim().toLowerCase().replace(/^@/, '');
  return task.tags.some(tag => tag.name === label || (tag.name === 'tag' && tag.value.trim().toLowerCase() === label));
}

function outlineTitle(task: TodoTask) {
  const source = todoTaskTitle(task);
  return todoReferences(source).reverse().reduce((title, reference) =>
    title.slice(0, reference.from) + reference.name + title.slice(reference.to), source);
}

function matchesState(task: TodoTask, state: string, today: string) {
  if (state === 'all') return true;
  if (state === 'closed') return task.status !== 'open';
  if (state === 'done' || state === 'cancelled') return task.status === state;
  if (task.archived || task.status !== 'open') return false;
  switch (state) {
    case 'open': return true;
    case 'today': {
      const due = task.tags.find(tag => tag.name === 'due')?.value.trim();
      return hasTag(task, 'today') || !!due && isTodoDate(due) && due <= today;
    }
    case 'waiting': return !!task.waiting;
    case 'follow-up': return needsTodoFollowUp(task, today);
    case 'ready': return !task.waiting && task.dependencies.every(dependency => dependency.state === 'done');
    case 'blocked': return task.dependencies.some(dependency => dependency.state !== 'done');
    case 'resume': return !!task.resume;
    default: return false;
  }
}

export default function TodoOutline({ model, today, jump }: { model: TodoModel; today: string; jump(line: number): void }) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all');
  const query = search.trim().toLowerCase();
  const view = model.views.find(item => status === `view:${item.name}`);
  const mode = status.startsWith('view:') ? 'all' : status;
  const tasks = model.tasks.filter(task => {
    if (!todoTaskTitle(task) || !matchesState(task, mode, today)) return false;
    if (view && !view.filters.every(filter => filter.name === 'tag' ? hasTag(task, filter.value) : matchesState(task, filter.value.trim(), today))) return false;
    if (query.startsWith('@')) return hasTag(task, query);
    return !query || `${task.text} ${task.path} ${task.resume?.text ?? ''} ${task.waiting?.person ?? ''}`.toLowerCase().includes(query);
  });
  const [resumeLine, setResumeLine] = useState(0);
  const steps = tasks.flatMap(task => !task.archived && task.status === 'open' && task.resume ? [task.resume] : []);
  const position = steps.findIndex(step => step.line === resumeLine);
  function navigateStep(delta: number) {
    const index = position < 0 ? (delta > 0 ? 0 : steps.length - 1) : (position + delta + steps.length) % steps.length;
    const next = steps[index]; setResumeLine(next.line); jump(next.line);
  }
  const matched = new Set(tasks.map(task => task.section));
  const rows = [
    ...model.sections.filter(section => (!query && mode === 'all' && !view) || matched.has(section.line)),
    ...tasks,
  ].sort((a, b) => a.line - b.line);
  return <aside className="td-outline" aria-label="清单大纲">
    <h3>大纲</h3>
    <div className="td-outline-filters">
      <input type="search" aria-label="筛选大纲" placeholder="搜索或输入 @标签" value={search} onChange={event => setSearch(event.target.value)} />
      <select aria-label="筛选任务状态" value={view ? status : mode} onChange={event => setStatus(event.target.value)}>
        <option value="all">全部</option><option value="open">待办</option><option value="today">今日与逾期</option><option value="closed">已结束</option>
        <option value="resume">继续做</option><option value="waiting">等待回访</option><option value="follow-up">到期回访</option>
        <option value="ready">可开始</option><option value="blocked">等待前置</option>
        {model.views.length > 0 && <optgroup label="自定义视图">{model.views.map(item => <option key={item.name} value={`view:${item.name}`}>{item.name}</option>)}</optgroup>}
      </select>
    </div>
    {!!steps.length && <nav className="resume-player" aria-label="浏览续做点"><button aria-label="上一个续做点" onClick={() => navigateStep(-1)}>‹</button><span>{position >= 0 ? steps[position].text : '继续做'} · {position >= 0 ? (position + 1) + '/' : ''}{steps.length}</span><button aria-label="下一个续做点" onClick={() => navigateStep(1)}>›</button></nav>}
    {rows.length ? <ul>{rows.map(item => {
      if (item.kind === 'section') return <li key={item.line}>
        <button type="button" className="td-outline-section" onClick={() => jump(item.line)}><ListTree size={14} /><strong>{item.path}</strong><small>{item.line}</small></button>
      </li>;
      const resume = !item.archived && item.status === 'open' ? item.resume : undefined;
      const followUp = needsTodoFollowUp(item, today);
      const title = outlineTitle(item);
      const checked = item.checks.filter(check => check.checked).length;
      return <li key={item.line} style={{ paddingInlineStart: `min(${item.level * 10}px, 30%)` }}>
        <button type="button" className="td-outline-task" onClick={() => jump(mode === 'resume' && resume ? resume.line : item.line)}>
          <span className={`td-mark-${item.status}`} aria-hidden="true">{item.status === 'done' ? '✔' : item.status === 'cancelled' ? '✘' : '☐'}</span>
          <span className="td-outline-task-name" title={item.text}>{title}</span>
          {item.checks.length > 0 ? <span className="td-check-progress">
            <small>{`验收 ${checked}/${item.checks.length}`}</small>
            <progress aria-label="验收进度" value={checked} max={item.checks.length} />
          </span> : <small>{item.line}</small>}
        </button>
        <div className="td-outline-details">{item.checks.length > 0 && <details><summary>验收明细</summary>{item.checks.map(check => <button key={check.line} onClick={() => jump(check.line)}>{check.checked ? '已验收' : '待验收'} · {check.text}</button>)}</details>}
          {resume && <button type="button" className="td-outline-resume" onClick={() => jump(resume.line)}><Play size={12} aria-hidden="true" /><span>继续做 · {resume.text}</span></button>}
          {!item.archived && item.status === 'open' && item.waiting && <small data-due={followUp}>
            <CalendarDays size={12} aria-hidden="true" /><span>{followUp ? '回访到期' : '等待回访'}{item.waiting.person && ` · ${item.waiting.person}`}{item.waiting.review && ` · ${item.waiting.review}`}</span>
          </small>}
          {!item.archived && item.status === 'open' && item.dependencies.map(dependency => {
            const text = `${dependencyLabels[dependency.state]} · ${dependency.id}`;
            return dependency.line && dependency.state !== 'self'
              ? <button key={dependency.id} type="button" onClick={() => jump(dependency.line!)}><GitBranch size={12} aria-hidden="true" /><span>{text}</span></button>
              : <small key={dependency.id} data-due="true"><GitBranch size={12} aria-hidden="true" /><span>{text}</span></small>;
          })}
        </div>
      </li>;
    })}</ul> : <p>没有匹配的任务。</p>}
  </aside>;
}
