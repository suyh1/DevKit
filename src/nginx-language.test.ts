import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { nginx } from './nginx-language';

function tokens(source: string) {
  const state = EditorState.create({ doc: source, extensions: nginx() });
  const result: { text: string; style: string }[] = [];
  highlightTree(syntaxTree(state), classHighlighter, (from, to, style) => result.push({ text: source.slice(from, to), style }));
  return result;
}
const token = (text: string, style: string) => ({ text, style: `tok-${style}` });

describe('Nginx source highlighting', () => {
  it('distinguishes directives, arguments, units, switches, and comments on the same line', () => {
    expect(tokens('server { listen 8080; client_max_body_size 20m; gzip on; custom_module custom_value; } # 注释')).toEqual(expect.arrayContaining([
      token('server', 'keyword'), token('listen', 'keyword'), token('8080', 'number'),
      token('20m', 'number'), token('on', 'bool'), token('custom_module', 'keyword'),
      token('custom_value', 'string'), token('# 注释', 'comment'),
    ]));
  });
  it('keeps directive-like values and IP/URL/path arguments distinct from directives and numbers', () => {
    const result = tokens('upstream backend { server 127.0.0.1:9000; }\nproxy_pass http://backend;\nroot D:/web/dist;\nset $name listen;');
    expect(result).toEqual(expect.arrayContaining([
      token('127.0.0.1:9000', 'string'), token('http://backend', 'string'),
      token('D:/web/dist', 'string'), token('listen', 'string'),
    ]));
  });
  it('highlights plain, braced, capture, and quoted variables without swallowing punctuation', () => {
    const result = tokens('proxy_set_header Host $host;\nreturn 301 "https://${host}$request_uri/$1";\nset $path /sites/${host}/html;');
    for (const name of ['$host', '${host}', '$request_uri', '$1', '$path']) {
      expect(result.some(item => item.style === 'tok-variableName2' && item.text.includes(name))).toBe(true);
    }
    expect(result).toContainEqual(token('return', 'keyword'));
    expect(result).toContainEqual(token('/html', 'string'));
  });
  it('protects quoted comment markers, escaped quotes, escaped variables, and multiline strings', () => {
    const source = String.raw`set $message "a # ; { \"quoted\" \$literal
still string";
set $other 'single # ` + '${value}' + String.raw`'; # actual comment`;
    const result = tokens(source);
    expect(result.filter(item => item.style === 'tok-comment')).toEqual([token('# actual comment', 'comment')]);
    expect(result.some(item => item.text.includes('still string') && item.style === 'tok-string')).toBe(true);
    expect(result.some(item => item.style === 'tok-variableName2' && item.text.includes('$literal'))).toBe(false);
    expect(result).toContainEqual(token('${value}', 'variableName2'));
  });
  it('handles BOM, CRLF, incomplete input and edits without changing the source', () => {
    const source = '\uFEFF# 保留\r\nhttp {\r\n include common_proxy.conf;\r\n set $name "unfinished ${host}';
    const state = EditorState.create({ doc: source, extensions: nginx() });
    const updated = state.update({ changes: { from: state.doc.length, insert: '";\nlisten 9011;' } }).state;
    const result: string[] = [];
    highlightTree(syntaxTree(updated), classHighlighter, (from, to) => result.push(updated.doc.sliceString(from, to)));
    expect(result).toContain('listen');
    expect(tokens('$; "')).toBeDefined();
    expect(state.sliceDoc()).toBe(source.replaceAll('\r\n', '\n'));
  });
});
