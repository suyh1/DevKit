import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { Compartment, EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { indentWithTab, isolateHistory } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { archiveTodo, parseTodo, planTodoCommand, readTodoLine, todoChildIndent, todoGroupAt, todoGroupDefaults, todoReferences, todoTaskTitle } from '../shared/todo-text.mjs';
import type { TodoLineAction, TodoReference } from '../shared/todo-text.mjs';
import { todoRendering, todoSourceMode } from './todo-rendering';

type Command = TodoLineAction | 'new' | 'child' | 'archive' | 'open-reference';
export type TodoEditorHandle = {
  run(command: Command): void;
  jump(line: number): void;
  applySyntax(body: string, edits: [line: number, text: string][]): boolean;
};
type Props = {
  body: string; readOnly: boolean; sourceMode: boolean; editorRef: Ref<TodoEditorHandle>;
  onChange: (body: string) => void; onSave: () => void; onArchive: (count: number) => void; onLine: (line: number) => void;
  onOpenReference: (reference: Pick<TodoReference, 'kind' | 'name'>) => void;
  onConfirmCompletion: (pendingChecks: number) => Promise<boolean>;
  onNotice: (text: string) => void;
};

function insertTask(view: EditorView, mode: 'new' | 'child' | 'continue') {
  if (view.state.readOnly || view.composing) return false;
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  const info = readTodoLine(line.text);
  if (mode === 'continue') {
    if (!selection.empty || info?.kind !== 'task' || info.status !== 'open') return false;
    const suffix = line.text.slice(selection.head - line.from);
    if (todoTaskTitle({ ...info, text: suffix })) return false;
    if (!todoTaskTitle(info)) {
      const from = line.from + info.indent.length;
      view.dispatch({ changes: { from, to: line.to }, selection: { anchor: from } });
      return true;
    }
  }
  const model = parseTodo(view.state.doc.toString());
  const anchor = model.tasksByLine.get(line.number) ?? model.resumesByLine.get(line.number);
  const child = mode === 'child';
  if (child && !anchor) return false;
  const empty = !line.text.trim();
  const originalIndent = /^[ \t]*/.exec(line.text)![0];
  const depth = originalIndent.replaceAll('\t', '  ').length;
  const section = todoGroupAt(model, anchor?.kind === 'resume' ? anchor.taskLine : line.number, empty && !originalIndent ? undefined : depth);
  let indent = originalIndent;
  if (child && anchor) indent = todoChildIndent(model, anchor);
  else if (info?.kind === 'section') indent += '  ';
  else if (empty && !originalIndent && section) indent = `${section.indent}  `;
  const lastLine = view.state.doc.line(anchor?.endLine ?? line.number);
  const from = empty ? line.from : lastLine.to;
  const prefix = `${empty ? '' : '\n'}${indent}☐ `;
  const defaults = todoGroupDefaults(model, section);
  const insert = defaults.length ? `${prefix} ${defaults.join(' ')}` : prefix;
  view.dispatch({ changes: { from, to: lastLine.to, insert }, selection: { anchor: from + prefix.length }, scrollIntoView: true });
  return true;
}

function selectedLines(view: EditorView) {
  const doc = view.state.doc, numbers = new Set<number>();
  for (const selection of view.state.selection.ranges) {
    const end = selection.empty ? selection.to : selection.to - 1;
    for (let i = doc.lineAt(selection.from).number; i <= doc.lineAt(end).number; i++) numbers.add(i);
  }
  return numbers;
}

export default function TodoTextEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const latest = useRef(props), editable = useRef(new Compartment()), presentation = useRef(new Compartment()), receiving = useRef(false);
  const confirming = useRef(false);
  latest.current = props;
  const access = (readOnly: boolean) => [
    EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({ 'aria-readonly': String(readOnly) }),
  ];
  const archive = (editor: EditorView) => {
    if (editor.state.readOnly) return false;
    const result = archiveTodo(editor.state.doc.toString());
    if (result.archived) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: result.body } });
    latest.current.onArchive(result.archived);
    return true;
  };
  const changeLines = (editor: EditorView, action: TodoLineAction) => {
    if (editor.state.readOnly || editor.composing) return false;
    if (confirming.current) return true;
    const doc = editor.state.doc, plan = planTodoCommand(parseTodo(doc.toString()), selectedLines(editor), action);
    const commit = () => {
      if (view.current !== editor || editor.state.readOnly || editor.state.doc !== doc) return;
      const changes = plan.edits.map(([number, insert]) => {
        const line = doc.line(number);
        return { from: line.from, to: line.to, insert };
      });
      if (plan.repeated) {
        const changeSet = editor.state.changes(changes);
        const lengths = new Map(plan.edits.map(([number, insert]) => [number, insert.split('\n', 1)[0].length]));
        const mapCursor = (position: number) => {
          const line = doc.lineAt(position), length = lengths.get(line.number);
          return length === undefined ? changeSet.mapPos(position) : changeSet.mapPos(line.from, -1) + Math.min(position - line.from, length);
        };
        const current = editor.state.selection;
        const selection = EditorSelection.create(current.ranges.map(range => EditorSelection.range(mapCursor(range.anchor), mapCursor(range.head))), current.mainIndex);
        editor.dispatch({ changes: changeSet, selection, annotations: isolateHistory.of('full') });
      } else if (changes.length) editor.dispatch({ changes });
      const messages = [];
      if (plan.repeated) messages.push(`已生成 ${plan.repeated} 项下期任务`);
      if (plan.invalidRepeats) messages.push(`${plan.invalidRepeats} 项周期或到期日格式无效`);
      if (messages.length) latest.current.onNotice(messages.join('，'));
    };
    if (!plan.pendingChecks) commit();
    else {
      confirming.current = true;
      void latest.current.onConfirmCompletion(plan.pendingChecks).then(confirmed => {
        if (confirmed) commit();
      }).finally(() => { confirming.current = false; });
    }
    return true;
  };
  const openReference = (editor: EditorView) => {
    const head = editor.state.selection.main.head, line = editor.state.doc.lineAt(head);
    const offset = head - line.from, references = todoReferences(line.text);
    const reference = references.find(item => item.from <= offset && item.to >= offset) ?? (references.length === 1 ? references[0] : undefined);
    if (reference) latest.current.onOpenReference(reference);
    else latest.current.onNotice('将光标放在要打开的引用内。');
    return true;
  };
  useImperativeHandle(props.editorRef, () => ({
    run(command) {
      const editor = view.current;
      if (!editor) return;
      if (command === 'archive') archive(editor);
      else if (command === 'new' || command === 'child') insertTask(editor, command);
      else if (command === 'open-reference') openReference(editor);
      else changeLines(editor, command);
      if (!confirming.current) editor.focus();
    },
    jump(number) {
      const editor = view.current;
      if (!editor) return;
      const line = editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, number)));
      editor.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      editor.focus();
    },
    applySyntax(body, edits) {
      const editor = view.current;
      if (!editor || editor.state.readOnly || editor.composing || editor.state.doc.toString() !== body) return false;
      if (!edits.length) return true;
      const changes = [...edits].sort(([a], [b]) => a - b).map(([number, insert]) => {
        const line = editor.state.doc.line(number);
        return { from: line.from, to: line.to, insert };
      });
      editor.dispatch({ changes, annotations: isolateHistory.of('full') });
      return true;
    },
  }), []);
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.body,
        extensions: [
          basicSetup, EditorState.tabSize.of(2), EditorView.lineWrapping,
          editable.current.of(access(latest.current.readOnly)), presentation.current.of(todoSourceMode.of(latest.current.sourceMode)), todoRendering,
          placeholder('输入分组名称并加上冒号，或添加一项任务'),
          EditorView.domEventHandlers({ click(event) {
            if (!(event.target instanceof Element)) return false;
            const mark = event.target.closest<HTMLElement>('.td-syntax-reference');
            if (!(event.ctrlKey || event.metaKey || mark?.dataset.previewReference)) return false;
            const kind = mark?.dataset.referenceKind, name = mark?.dataset.referenceName;
            if (!name || (kind !== 'tool' && kind !== 'share')) return false;
            latest.current.onOpenReference({ kind, name });
            return true;
          } }),
          Prec.highest(keymap.of([
            { key: 'Mod-s', run: () => { latest.current.onSave(); return true; } },
            { key: 'Mod-Enter', run: editor => changeLines(editor, 'box') },
            { key: 'Alt-Enter', run: editor => changeLines(editor, 'box') },
            { key: 'Alt-d', run: editor => changeLines(editor, 'done') },
            { key: 'Alt-c', run: editor => changeLines(editor, 'cancelled') },
            { key: 'Alt-s', run: editor => changeLines(editor, 'started') },
            { key: 'Alt-o', run: openReference },
            { key: 'Mod-Shift-a', run: archive },
            { key: 'Enter', run: editor => insertTask(editor, 'continue') },
          ])),
          keymap.of([indentWithTab]),
          EditorView.contentAttributes.of({ 'aria-label': '待办文本', 'aria-multiline': 'true', spellcheck: 'false', tabindex: '0' }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !receiving.current) latest.current.onChange(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) latest.current.onLine(update.state.doc.lineAt(update.state.selection.main.head).number);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === props.body) return;
    receiving.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.body }, annotations: Transaction.addToHistory.of(false) });
    receiving.current = false;
  }, [props.body]);
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure(access(props.readOnly)) }); }, [props.readOnly]);
  useEffect(() => { view.current?.dispatch({ effects: presentation.current.reconfigure(todoSourceMode.of(props.sourceMode)) }); }, [props.sourceMode]);
  return <div className="td-editor" ref={host} />;
}
