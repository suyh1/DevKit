import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { StringStream } from '@codemirror/language';
import { tags } from '@lezer/highlight';

type State = { directive: boolean; quote: string; depth: number };
const variable = /^\$(?:\{[\w]+\}|[\w]+)/;

function quoted(stream: StringStream, state: State): string {
  if (stream.match(variable)) return 'variableName.special';
  while (!stream.eol()) {
    if (stream.peek() === '$' && stream.match(variable, false)) break;
    const char = stream.next();
    if (char === '\\') stream.next();
    else if (char === state.quote) { state.quote = ''; break; }
  }
  return 'string';
}

// Classify by directive/argument position rather than a fixed module keyword list.
// Quotes and escapes keep comment markers and variable braces out of block state.
export const nginxLanguage = StreamLanguage.define<State>({
  name: 'nginx',
  startState: () => ({ directive: true, quote: '', depth: 0 }),
  token(stream, state) {
    if (state.quote) return quoted(stream, state);
    if (stream.eatSpace()) return null;
    const char = stream.peek();
    if (char === '#') { stream.skipToEnd(); return 'comment'; }
    if (char === '{' || char === '}' || char === ';') {
      stream.next();
      if (char === '{') state.depth++;
      if (char === '}') state.depth = Math.max(0, state.depth - 1);
      state.directive = true;
      return char === ';' ? 'separator' : 'brace';
    }
    if (char === '"' || char === "'") {
      state.quote = stream.next()!;
      state.directive = false;
      // Leave the quote in this token, even when a variable immediately follows it.
      if (stream.match(variable, false)) return 'string';
      return quoted(stream, state);
    }
    if (stream.match(variable)) { state.directive = false; return 'variableName.special'; }
    const directive = state.directive;
    state.directive = false;
    while (!stream.eol()) {
      const next = stream.peek()!;
      if (/[\s;{}#"']/.test(next) || (next === '$' && stream.match(variable, false))) break;
      stream.next();
      if (next === '\\') stream.next();
    }
    // A lone '$' or another incomplete token must still advance while typing.
    if (stream.pos === stream.start) stream.next();
    if (directive) return 'keyword';
    if (/^(?:on|off|true|false)$/.test(stream.current())) return 'bool';
    if (/^\d+(?:\.\d+)?(?:[kKmMgG]|ms|[smhdwy])?$/.test(stream.current())) return 'number';
    if (/^(?:=|~\*?|!~\*?|\^~)$/.test(stream.current())) return 'operator';
    return 'string';
  },
  indent: (state, after, context) => state.quote ? null : Math.max(0, state.depth - (/^\s*\}/.test(after) ? 1 : 0)) * context.unit,
  languageData: { commentTokens: { line: '#' }, indentOnInput: /^\s*\}$/ },
});

const variables = HighlightStyle.define([
  { tag: tags.special(tags.variableName), color: 'var(--syntax-key)' },
], { scope: nginxLanguage });

export function nginx() { return [nginxLanguage, syntaxHighlighting(variables)]; }
