import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, StreamLanguage, indentUnit } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { EditorLanguage, CodeEditorProps } from './CodeEditor';

async function languageSupport(language: EditorLanguage) {
  if (language === 'json') return (await import('@codemirror/lang-json')).json();
  if (language === 'javascript') return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
  if (language === 'html') return (await import('@codemirror/lang-html')).html();
  if (language === 'xml') return (await import('@codemirror/lang-xml')).xml();
  if (language === 'typescript') return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true });
  if (language === 'java') return (await import('@codemirror/lang-java')).java();
  if (language === 'css') return (await import('@codemirror/lang-css')).css();
  if (language === 'yaml') return (await import('@codemirror/lang-yaml')).yaml();
  if (language === 'sql') return (await import('@codemirror/lang-sql')).sql();
  if (language === 'diff') return StreamLanguage.define({ token(stream) { const char = stream.peek(); stream.skipToEnd(); return char === '+' ? 'inserted' : char === '-' ? 'deleted' : char === '@' ? 'meta' : null; } });
  return [];
}
const highlighting = HighlightStyle.define([
  { tag: tags.inserted, color: 'var(--diff-added)', backgroundColor: 'var(--diff-added-bg)' },
  { tag: tags.deleted, color: 'var(--diff-deleted)', backgroundColor: 'var(--diff-deleted-bg)' },
  { tag: tags.meta, color: 'var(--syntax-keyword)' },
  { tag: tags.propertyName, color: 'var(--syntax-key)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: tags.comment, color: 'var(--syntax-comment)' },
  { tag: [tags.typeName, tags.className], color: 'var(--syntax-type)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-function)' },
]);

export default function CodeEditorView(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const initial = useRef(props), change = useRef(props.onChange), syncing = useRef(false);
  const compartments = useRef({ editable: new Compartment(), wrapping: new Compartment(), language: new Compartment(), indent: new Compartment() });
  change.current = props.onChange;
  useEffect(() => {
    if (!host.current) return;
    const values = initial.current, config = compartments.current;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: values.value,
        extensions: [basicSetup, syntaxHighlighting(highlighting), keymap.of([indentWithTab]),
          config.indent.of([EditorState.tabSize.of(values.tabSize || 2), indentUnit.of(' '.repeat(values.tabSize || 2))]),
          config.language.of([]),
          config.editable.of([EditorState.readOnly.of(!!values.readOnly), EditorView.editable.of(!values.readOnly || !!values.onChange)]),
          config.wrapping.of(values.wrap !== false ? EditorView.lineWrapping : []),
          placeholder(values.placeholder || ''),
          EditorView.contentAttributes.of({ 'aria-label': values.label, 'aria-multiline': 'true', 'aria-readonly': String(!!values.readOnly), role: 'textbox', spellcheck: 'false', tabindex: '0' }),
          EditorView.updateListener.of(update => { if (update.docChanged && !syncing.current) change.current?.(update.state.doc.toString()); }),
        ],
      }),
    });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value) {
      syncing.current = true;
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.value } });
      syncing.current = false;
    }
  }, [props.value]);
  useEffect(() => { view.current?.dispatch({ effects: compartments.current.editable.reconfigure([EditorState.readOnly.of(!!props.readOnly), EditorView.editable.of(!props.readOnly || !!change.current)]) }); }, [props.readOnly]);
  useEffect(() => {
    let cancelled = false;
    languageSupport(props.language || 'text').then(extension => {
      if (!cancelled) view.current?.dispatch({ effects: compartments.current.language.reconfigure(extension) });
    }).catch(() => { /* Keep a usable plain-text editor when a language chunk is unavailable. */ });
    return () => { cancelled = true; };
  }, [props.language]);
  useEffect(() => { view.current?.dispatch({ effects: compartments.current.wrapping.reconfigure(props.wrap !== false ? EditorView.lineWrapping : []) }); }, [props.wrap]);
  useEffect(() => { view.current?.dispatch({ effects: compartments.current.indent.reconfigure([EditorState.tabSize.of(props.tabSize || 2), indentUnit.of(' '.repeat(props.tabSize || 2))]) }); }, [props.tabSize]);
  return <div className={`code-editor ${props.readOnly ? 'is-readonly' : ''}`} ref={host} />;
}
