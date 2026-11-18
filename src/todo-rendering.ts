import { Facet } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { changeTodoLine, isTodoDate, readTodoLine, todoDateKey, todoReferences, todoTags } from '../shared/todo-text.mjs';
import type { TodoReference, TodoTag } from '../shared/todo-text.mjs';
import { todoViewStates } from './todo-syntax-actions';

export const todoSourceMode = Facet.define<boolean, boolean>({ combine: values => values[0] ?? false });

const ruleLabels = { 接着: '续做点', 视图: '视图', 默认: '分组默认' };
const tagLabels: Record<string, string> = {
  today: '今天', due: '截止', review: '回访', wait: '等待', after: '前置', repeat: '重复', owner: '负责人',
  id: 'ID', tag: '标签', state: '状态', started: '已开始', done: '已完成', cancelled: '已取消', project: '原分组',
  critical: '紧急', high: '高优先级', low: '低优先级',
};

class TodoToken extends WidgetType {
  constructor(readonly text: string, readonly kind: 'meta' | 'rule' | 'resume' | 'reference', readonly source: string,
    readonly tone = '', readonly reference?: TodoReference) { super(); }

  eq(other: TodoToken) {
    return this.text === other.text && this.kind === other.kind && this.source === other.source && this.tone === other.tone;
  }

  toDOM(view: EditorView) {
    const span = view.dom.ownerDocument.createElement('span');
    span.className = `td-preview-token td-preview-${this.kind}`;
    span.dataset.tone = this.tone;
    span.textContent = this.text;
    span.title = this.source;
    if (this.reference) {
      span.classList.add('td-syntax-reference');
      span.dataset.referenceKind = this.reference.kind;
      span.dataset.referenceName = this.reference.name;
      span.dataset.previewReference = 'true';
      span.title = `打开${this.reference.kind === 'share' ? '共享' : '工具'} ${this.reference.name}`;
      span.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
    }
    return span;
  }

  ignoreEvent(event: Event) { return this.kind !== 'reference' || event.type !== 'click'; }
}

class AcceptanceBox extends WidgetType {
  constructor(readonly checked: boolean, readonly editable: boolean, readonly text: string) { super(); }

  eq(other: AcceptanceBox) { return this.checked === other.checked && this.editable === other.editable && this.text === other.text; }

  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement(this.editable ? 'button' : 'span');
    element.className = 'td-preview-check';
    element.dataset.checked = String(this.checked);
    element.setAttribute('role', 'checkbox');
    element.setAttribute('aria-checked', String(this.checked));
    element.setAttribute('aria-label', this.text || '验收条件');
    if (!this.editable) { element.setAttribute('aria-disabled', 'true'); return element; }
    const button = element as HTMLButtonElement;
    button.type = 'button';
    button.title = this.checked ? '取消勾选验收条件' : '勾选验收条件';
    button.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
    button.addEventListener('click', () => {
      if (view.state.readOnly || view.composing) return;
      const line = view.state.doc.lineAt(view.posAtDOM(button));
      if (readTodoLine(line.text)?.kind !== 'check') return;
      view.dispatch({ changes: { from: line.from, to: line.to, insert: changeTodoLine(line.text, 'done', '') },
        annotations: isolateHistory.of('full') });
    });
    return button;
  }
}

function tagToken(tag: TodoTag, source: string, today: string) {
  const value = tag.value.trim();
  const shown = tag.name === 'state' ? todoViewStates.find(([key]) => key === value)?.[1] || value : value;
  const tone = tag.name === 'critical' ? 'critical'
    : tag.name === 'high' || tag.name === 'review' && isTodoDate(value) && value <= today ? 'warning'
      : tag.name === 'today' ? 'active' : '';
  const label = Object.hasOwn(tagLabels, tag.name) ? tagLabels[tag.name] : tag.name;
  return new TodoToken([label, shown].filter(Boolean).join(' '), 'meta', source, tone);
}

function decorations(view: EditorView) {
  const marks: Range<Decoration>[] = [], seen = new Set<number>();
  const sourceMode = view.state.facet(todoSourceMode), readOnly = view.state.readOnly, today = todoDateKey();
  const replace = (from: number, to: number, widget: WidgetType) => marks.push(Decoration.replace({ widget }).range(from, to));
  const style = (from: number, to: number, className: string, attributes?: Record<string, string>) => {
    if (to > from) marks.push(Decoration.mark({ class: className, attributes }).range(from, to));
  };
  for (const { from, to } of view.visibleRanges) {
    for (let line = view.state.doc.lineAt(from); line.from <= to; line = view.state.doc.line(line.number + 1)) {
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const raw = sourceMode || (!readOnly && view.hasFocus && view.state.selection.ranges.some(range => range.from <= line.to && range.to >= line.from));
        const info = readTodoLine(line.text);
        const tagStart = info?.kind === 'task' ? info.textFrom : info?.kind === 'directive' ? info.prefixTo : 0;
        const tags = info?.kind === 'task' ? info.tags : info?.kind === 'directive' && info.command !== '接着' ? todoTags(info.text) : [];

        if (!raw && (info?.kind === 'task' || info?.kind === 'check')) {
          const indent = Math.min(info.depth + (info.kind === 'task' ? info.symbol.length + 1 : 3), 14);
          marks.push(Decoration.line({ class: 'td-preview-hanging', attributes: { style: `--td-hang: ${indent}ch` } }).range(line.from));
        }

        if (info?.kind === 'section') style(line.from + info.indent.length, line.to, 'td-syntax-section');
        if (info?.kind === 'task') {
          if (info.status !== 'open') marks.push(Decoration.line({ class: `td-line-${info.status}` }).range(line.from));
          const start = line.from + info.indent.length;
          style(start, start + info.symbol.length, `td-syntax-mark td-mark-${info.status}`);
        }
        if (info?.kind === 'check') {
          const start = line.from + info.indent.length;
          if (raw) style(start, line.to, info.checked ? 'td-syntax-check td-mark-done' : 'td-syntax-check');
          else {
            replace(start, line.from + info.prefixTo, new AcceptanceBox(info.checked, !readOnly, info.text));
            style(line.to - info.text.length, line.to, info.checked ? 'td-acceptance-text td-acceptance-checked' : 'td-acceptance-text');
          }
        }
        if (info?.kind === 'directive') {
          const start = line.from + info.indent.length, end = line.from + info.prefixTo;
          if (raw) style(start, end, 'td-syntax-directive');
          else replace(start, end, new TodoToken(ruleLabels[info.command], info.command === '接着' ? 'resume' : 'rule', line.text.slice(info.indent.length, info.prefixTo).trim()));
        }
        if (!info && /^\s*#/.test(line.text)) style(line.from, line.to, 'td-syntax-note');

        for (const tag of tags) {
          const start = tagStart + tag.from, end = tagStart + tag.to;
          if (raw) style(line.from + start, line.from + end, 'td-syntax-tag', { 'data-tag': tag.name });
          else replace(line.from + start, line.from + end, tagToken(tag, line.text.slice(start, end), today));
        }
        for (const reference of todoReferences(line.text)) {
          if (raw) style(line.from + reference.from, line.from + reference.to, 'td-syntax-reference', {
            'data-reference-kind': reference.kind, 'data-reference-name': reference.name, title: 'Ctrl/⌘+单击打开引用',
          });
          else if (tags.every(tag => tagStart + tag.to <= reference.from || tagStart + tag.from >= reference.to)) {
            replace(line.from + reference.from, line.from + reference.to, new TodoToken(reference.name, 'reference', line.text.slice(reference.from, reference.to), '', reference));
          }
        }
      }
      if (line.number === view.state.doc.lines) break;
    }
  }
  return Decoration.set(marks, true);
}

export const todoRendering = ViewPlugin.fromClass(class {
  marks;
  constructor(view: EditorView) { this.marks = decorations(view); }
  update(change: ViewUpdate) {
    if (change.docChanged || change.viewportChanged || change.selectionSet || change.focusChanged ||
      change.startState.readOnly !== change.state.readOnly || change.startState.facet(todoSourceMode) !== change.state.facet(todoSourceMode)) {
      this.marks = decorations(change.view);
    }
  }
}, { decorations: plugin => plugin.marks });
