const marker = /^([ \t]*)(☐|□|✔|✓|☑|✘|✗|(?:[-+*][ \t]+)?\[(?: |x|X|\+|-)?\]|-)(?=[ \t]|$)[ \t]?(.*)$/u;
const tagPattern = /(?<!\S)@([\p{L}\p{N}_-]+)(?:\(([^)\r\n]*)\))?/gu;
const checkPattern = /^([ \t]*)([?？][ \t]+(?:\[([ xX✓✔])\](?=[ \t]|$))?)[ \t]*(.*)$/u;
const directivePattern = /^([ \t]*)(?:::|：：)[ \t]+(接着|续做点?|自定义视图|视图|分组默认|默认)[ \t]+(\S.*)$/u;
const directiveNames = { 接着: '接着', 续做: '接着', 续做点: '接着', 自定义视图: '视图', 视图: '视图', 分组默认: '默认', 默认: '默认' };
const referencePattern = /\[\[(共享|工具)[:：]([^\[\]\r\n]+)\]\]/gu;
const statusMarkers = { open: '☐', done: '✔', cancelled: '✘' };
const indentWidth = indent => [...indent].reduce((width, char) => width + (char === '\t' ? 2 : 1), 0);
const archiveName = /^[ \t]*(?:archive|归档)$/iu;
const viewStates = new Set(['open', 'done', 'cancelled', 'closed', 'today', 'waiting', 'follow-up', 'ready', 'blocked']);
const defaultExclusions = new Set(['started', 'done', 'cancelled', 'id', 'after', 'repeat']);
const valueOf = (tags, name) => tags.find(tag => tag.name === name)?.value.trim();
export const todoDefault = '待办:\n';
export const todoStorageLimit = 16_000_000;

export function todoTags(text) {
  return [...text.matchAll(tagPattern)].map(match => ({
    name: match[1].toLowerCase(), value: match[2] ?? '', from: match.index, to: match.index + match[0].length,
  }));
}

export const isTodoDefaultTag = name => !defaultExclusions.has(name);

export function todoReferences(text) {
  return [...text.matchAll(referencePattern)].flatMap(match => {
    const name = match[2].trim();
    return name ? [{ kind: match[1] === '共享' ? 'share' : 'tool', name, from: match.index, to: match.index + match[0].length }] : [];
  });
}

export function readTodoLine(line) {
  const task = marker.exec(line);
  if (task) {
    const [, indent, symbol, text] = task;
    const tags = todoTags(text);
    const status = /^(?:✘|✗|(?:[-+*][ \t]+)?\[-\])$/u.test(symbol) || tags.some(tag => tag.name === 'cancelled')
      ? 'cancelled' : /^[✔✓☑]$/u.test(symbol) || /\[[xX+]\]$/u.test(symbol) || tags.some(tag => tag.name === 'done') ? 'done' : 'open';
    return { kind: 'task', indent, depth: indentWidth(indent), symbol, text, status, tags, textFrom: line.length - text.length };
  }
  const check = checkPattern.exec(line);
  if (check && (check[3] !== undefined || (check[1] && !check[4].startsWith('[')))) {
    const [, indent, prefix, symbol, text] = check;
    return { kind: 'check', indent, depth: indentWidth(indent), text, prefixTo: indent.length + prefix.length, checked: !!symbol?.trim() };
  }
  const directive = directivePattern.exec(line);
  if (directive) {
    const [, indent, command, text] = directive;
    return { kind: 'directive', indent, depth: indentWidth(indent), command: directiveNames[command], text, prefixTo: line.length - text.length };
  }
  const section = /^([ \t]*)([^\s].*?)[:：][ \t]*$/u.exec(line);
  if (!section || section[2].startsWith('#')) return undefined;
  return { kind: 'section', indent: section[1], depth: indentWidth(section[1]), name: section[2].trim() };
}

export function parseTodo(body) {
  const lines = body.split('\n'), sections = [], tasks = [], views = new Map(), stack = [], parents = [];
  const checks = new Map(), tasksByLine = new Map(), sectionsByLine = new Map();
  const byId = new Map();
  let previous = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const number = index + 1;
    const info = readTodoLine(line);
    const depth = info?.depth ?? indentWidth(/^[ \t]*/.exec(line)[0]);
    while (parents.length && parents.at(-1).depth >= depth) parents.pop().endLine = previous;
    if (info?.kind === 'section') {
      while (stack.length && stack.at(-1).depth >= info.depth) stack.pop();
      const section = {
        ...info, line: number, parent: stack.at(-1)?.line,
        path: [...stack.map(item => item.name), info.name].join(' / '),
        archived: archiveName.test(info.name) || stack.at(-1)?.archived === true,
        defaults: new Map(), defaultLines: [],
      };
      stack.push(section);
      sections.push(section);
      sectionsByLine.set(number, section);
    } else if (info?.kind === 'task') {
      while (stack.length && stack.at(-1).depth > info.depth) stack.pop();
      const assigned = stack.at(-1), waiting = info.tags.find(tag => tag.name === 'wait');
      const review = valueOf(info.tags, 'review') || '';
      const task = {
        ...info, line: number, endLine: number, section: assigned?.line, path: assigned?.path ?? '',
        archived: assigned?.archived === true, checks: [], dependencies: [],
        waiting: waiting || review ? { person: waiting?.value.trim() || '', review } : undefined,
      };
      tasks.push(task);
      tasksByLine.set(number, task);
      parents.push(task);
      const id = valueOf(info.tags, 'id')?.toLowerCase();
      if (id) {
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(task);
      }
    } else if (info?.kind === 'check' && parents.length) {
      const owner = parents.at(-1);
      const check = { ...info, line: number, taskLine: owner.line };
      owner.checks.push(check);
      checks.set(number, check);
    } else if (info?.kind === 'directive') {
      const enclosing = stack.findLast(section => section.depth < depth);
      const owner = parents.at(-1);
      if (info.command === '接着' && owner) owner.resume = { line: number, text: info.text.trim() };
      if (info.command === '默认' && enclosing && !enclosing.archived) {
        enclosing.defaultLines.push(number);
        for (const tag of todoTags(info.text)) {
          if (isTodoDefaultTag(tag.name)) enclosing.defaults.set(tag.name, info.text.slice(tag.from, tag.to));
        }
      }
      if (info.command === '视图' && !enclosing?.archived) {
        const filters = todoTags(info.text), name = info.text.slice(0, filters[0]?.from ?? info.text.length).trim();
        const valid = filters.length > 0 && filters.every(tag => tag.name === 'tag' ? !!tag.value.trim() : tag.name === 'state' && viewStates.has(tag.value.trim()));
        if (name && valid) views.set(name, { line: number, name, filters });
      }
    }
    previous = number;
  }
  for (const task of parents) task.endLine = previous;
  for (const task of tasks) {
    const ids = new Set(task.tags.filter(tag => tag.name === 'after').flatMap(tag => tag.value.split(',').map(id => id.trim().toLowerCase())).filter(Boolean));
    task.dependencies = [...ids].map(id => {
      const candidates = byId.get(id) ?? [];
      const target = candidates.length === 1 ? candidates[0] : undefined;
      const state = target === task ? 'self' : target ? target.status : candidates.length ? 'duplicate' : 'missing';
      return { id, line: target?.line, state };
    });
  }
  return { lines, sections, tasks, views: [...views.values()], checks, tasksByLine, sectionsByLine };
}

export function todoGroupAt(model, line, depth) {
  const task = model.tasks.findLast(item => item.line <= line);
  const recent = model.sections.findLast(item => item.line <= line);
  if (recent?.line === line) return recent;
  let section = recent && recent.line > (task?.line ?? 0) ? recent : model.sectionsByLine.get(task?.section);
  if (depth !== undefined) {
    while (section && section.depth > depth) section = model.sectionsByLine.get(section.parent);
  }
  return section;
}

export function todoGroupDefaults(model, section) {
  const defaults = new Map();
  while (section && !section.archived) {
    for (const [key, value] of section.defaults) if (!defaults.has(key)) defaults.set(key, value);
    section = model.sectionsByLine.get(section.parent);
  }
  return [...defaults.values()];
}

const isStatusTag = name => name === 'done' || name === 'cancelled';
function removeTags(text, shouldRemove) {
  for (const tag of todoTags(text).filter(item => shouldRemove(item.name)).reverse()) {
    const before = text.slice(0, tag.from);
    text = before.replace(/[ \t]+$/, '') + text.slice(tag.to);
  }
  return text.trimEnd();
}
function appendTag(text, tag) {
  return text.trimEnd() ? `${text.trimEnd()} ${tag}` : tag;
}
export function replaceTodoTags(text, names, tags) {
  return tags.reduce(appendTag, removeTags(text, name => names.includes(name)));
}
export function todoTaskTitle(task) {
  return removeTags(task.text, () => true).trim();
}
export function changeTodoLine(line, action, timestamp) {
  const parsed = readTodoLine(line);
  const task = parsed?.kind === 'task' ? parsed : undefined;
  if (parsed?.kind === 'check') {
    if (action !== 'done') return line;
    const index = parsed.prefixTo - 2;
    return line[parsed.prefixTo - 1] === ']'
      ? `${line.slice(0, index)}${parsed.checked ? ' ' : 'x'}${line.slice(index + 1)}`
      : `${parsed.indent}? [x] ${parsed.text}`.trimEnd();
  }
  if (action === 'box') {
    if (task) return task.indent + removeTags(task.text, name => isStatusTag(name) || name === 'started');
    if (parsed) return line;
    return line.replace(/^([ \t]*)/, '$1☐ ');
  }
  if (!task) return line;
  if (action === 'started') {
    if (task.status !== 'open') return line;
    const text = task.tags.some(tag => tag.name === 'started') ? removeTags(task.text, name => name === 'started') : appendTag(task.text, `@started(${timestamp})`);
    return `${task.indent}${task.symbol} ${text}`;
  }
  let text = removeTags(task.text, isStatusTag);
  const status = task.status === action ? 'open' : action;
  if (status !== 'open') text = appendTag(text, `@${status}(${timestamp})`);
  return `${task.indent}${statusMarkers[status]} ${text}`;
}

export function isTodoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(+date) && date.toISOString().startsWith(value);
}

function nextDue(rule, due, today) {
  const day = 86_400_000;
  const date = value => new Date(value + 'T00:00:00.000Z');
  const iso = value => value.toISOString().split('T')[0];
  const base = date(due || today), cutoff = date(due && due > today ? due : today);
  if (rule === '每天' || rule === '每周') {
    const interval = day * (rule === '每天' ? 1 : 7);
    return iso(new Date(+base + (Math.floor((cutoff - base) / interval) + 1) * interval));
  }
  const weekday = /^每周([一二三四五六日天])$/.exec(rule);
  if (weekday) {
    const target = '日一二三四五六'.indexOf(weekday[1] === '天' ? '日' : weekday[1]);
    return iso(new Date(+cutoff + ((target - cutoff.getUTCDay() + 7) % 7 || 7) * day));
  }
  const monthly = /^每月(?:(\d{1,2})[日号])?$/.exec(rule);
  if (!monthly) return '';
  const target = monthly[1] ? Number(monthly[1]) : base.getUTCDate();
  if (target < 1 || target > 31) return '';
  const candidate = new Date(cutoff);
  const inMonth = offset => {
    candidate.setUTCMonth(cutoff.getUTCMonth() + offset + 1, 0);
    candidate.setUTCDate(Math.min(target, candidate.getUTCDate()));
  };
  inMonth(0);
  if (candidate <= cutoff) inMonth(1);
  return iso(candidate);
}

const occurrenceTags = new Set(['id', 'after', 'due', 'today', 'started', 'done', 'cancelled', 'wait', 'review']);
export function planTodoCommand(model, numbers, action, now = new Date()) {
  const selected = new Set(numbers), edits = new Map(), insertions = new Map();
  let pendingChecks = 0, repeated = 0, invalidRepeats = 0;
  const stamp = todoTimestamp(now);
  for (const number of selected) {
    const text = model.lines[number - 1];
    if (text === undefined) continue;
    let result = changeTodoLine(text, action, stamp);
    const task = model.tasksByLine.get(number);
    if (action === 'box' && !task && text !== result) {
      const depth = indentWidth(/^[ \t]*/.exec(text)[0]);
      const names = new Set(todoTags(result).map(tag => tag.name));
      for (const tag of todoGroupDefaults(model, todoGroupAt(model, number, depth))) {
        if (!names.has(todoTags(tag)[0].name)) result = appendTag(result, tag);
      }
    }
    if (action === 'done' && task && task.status !== 'done') {
      pendingChecks += task.checks.filter(check => check.checked === selected.has(check.line)).length;
      const repeat = valueOf(task.tags, 'repeat');
      if (repeat !== undefined && !task.archived && todoTaskTitle(task)) {
        const due = valueOf(task.tags, 'due');
        const next = due && !isTodoDate(due) ? '' : nextDue(repeat, due, todoDateKey(now));
        if (isTodoDate(next)) {
          result = removeTags(result, name => name === 'repeat');
          const lines = [
            `${task.indent}☐ ${appendTag(removeTags(task.text, name => occurrenceTags.has(name)), `@due(${next})`)}`,
            ...task.checks.map(check => `${check.indent}? [ ] ${check.text}`.trimEnd()),
          ];
          const blocks = insertions.get(task.endLine) ?? [];
          blocks.push({ number, lines });
          insertions.set(task.endLine, blocks);
          repeated++;
        } else invalidRepeats++;
      }
    }
    if (text !== result) edits.set(number, result);
  }
  for (const [line, blocks] of insertions) {
    const additions = blocks.sort((a, b) => b.number - a.number).flatMap(block => block.lines);
    edits.set(line, [edits.get(line) ?? model.lines[line - 1], ...additions].join('\n'));
  }
  return { edits: [...edits].sort((a, b) => a[0] - b[0]), pendingChecks, repeated, invalidRepeats };
}

export function archiveTodo(body) {
  const { lines, sections, tasks } = parseTodo(body);
  const taskAt = new Map(tasks.map(task => [task.line - 1, task]));
  const removed = new Set(), blocks = [];
  for (const task of tasks) {
    const index = task.line - 1;
    if (task.archived || task.status === 'open' || removed.has(index)) continue;
    let end = index + 1, openChild = false;
    for (let scan = end; scan < lines.length; scan++) {
      const line = lines[scan];
      if (!line.trim()) continue;
      if (indentWidth(/^[ \t]*/.exec(line)[0]) <= task.depth) break;
      end = scan + 1;
      if (taskAt.get(scan)?.status === 'open') openChild = true;
    }
    if (openChild) continue;
    const block = lines.slice(index, end).map(line => {
      if (!line.trim()) return line;
      const indent = /^[ \t]*/.exec(line)[0];
      return ' '.repeat(2 + Math.max(0, indentWidth(indent) - task.depth)) + line.slice(indent.length);
    });
    if (task.path && !task.tags.some(tag => tag.name === 'project')) {
      block[0] = appendTag(block[0], `@project(${task.path.replaceAll(')', '）')})`);
    }
    for (let line = index; line < end; line++) removed.add(line);
    blocks.push(block);
  }
  if (!blocks.length) return { body, archived: 0 };
  const existing = sections.find(section => section.depth === 0 && archiveName.test(section.name));
  let insertAt = existing ? (sections.find(section => section.depth === 0 && section.line > existing.line)?.line ?? lines.length + 1) - 1 : lines.length;
  while (insertAt > (existing?.line ?? 0) && !lines[insertAt - 1].trim()) insertAt--;
  const retained = [];
  for (let index = 0; index <= lines.length; index++) {
    if (index === insertAt) {
      if (!existing) {
        if (retained.length && retained.at(-1).trim()) retained.push('');
        retained.push('Archive:');
      }
      retained.push(...blocks.flat());
    }
    if (index < lines.length && !removed.has(index)) retained.push(lines[index]);
  }
  return { body: retained.join('\n'), archived: removed.size ? tasks.filter(task => removed.has(task.line - 1)).length : 0 };
}

export function todoDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
export function todoTimestamp(date = new Date()) {
  return `${todoDateKey(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
