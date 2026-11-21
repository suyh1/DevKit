import { markdown } from '@codemirror/lang-markdown';
import { jsonLanguage } from '@codemirror/lang-json';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { yamlLanguage } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { tags, classHighlighter, highlightTree } from '@lezer/highlight';
import { nginxLanguage } from './nginx-language';
const shellLanguage = StreamLanguage.define(shell);
function fenceLanguage(name: string) {
  switch (name.toLowerCase()) {
    case 'nginx':
      return nginxLanguage;
    case 'json':
      return jsonLanguage;
    case 'js':
    case 'javascript':
      return javascriptLanguage;
    case 'yaml':
    case 'yml':
      return yamlLanguage;
    case 'sh':
    case 'bash':
    case 'shell':
      return shellLanguage;
    default:
      return null;
  }
}

export function colorCodeBlocks(blocks: HTMLElement[]) {
  for (const node of blocks) {
    const language = fenceLanguage(node.className.replace(/^language-/, '')),
      source = node.textContent || '';
    if (!language || !source) continue;
    const output = document.createDocumentFragment();
    let offset = 0;
    highlightTree(language.parser.parse(source), classHighlighter, (from, to, classes) => {
      output.append(source.slice(offset, from));
      const span = document.createElement('span');
      span.className = classes;
      span.textContent = source.slice(from, to);
      output.append(span);
      offset = to;
    });
    output.append(source.slice(offset));
    node.replaceChildren(output);
  }
}
export function knowledgeLanguage() {
  return [
    markdown({ codeLanguages: fenceLanguage }),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.heading, color: 'var(--syntax-keyword)', fontWeight: 'bold' },
        { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
        { tag: tags.url, color: 'var(--syntax-string)' },
        { tag: tags.strong, fontWeight: 'bold' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.monospace, color: 'var(--syntax-function)' },
      ]),
    ),
    keymap.of(
      [
        ['Mod-b', '**'],
        ['Mod-i', '*'],
        ['Mod-e', '`'],
      ].map(([key, mark]) => ({
        key,
        run(view) {
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: mark + view.state.sliceDoc(from, to) + mark },
            selection: { anchor: from + mark.length, head: to + mark.length },
          });
          return true;
        },
      })),
    ),
  ];
}
