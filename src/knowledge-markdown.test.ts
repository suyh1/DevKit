import { expect, it } from 'vitest';
import { articleLayout, bodyMatch, referenceText, refersTo, renderArticle } from './knowledge-markdown';

it('matches the exact host-qualified resource and ignores examples and plain text', () => {
  const id = 'host:实例 (A)';
  const link = referenceText('jar', id, '订单 [主] 服务');
  expect(refersTo(link, 'jar', id)).toBe(true);
  expect(refersTo(link, 'nginx', id)).toBe(false);
  expect(refersTo(link, 'jar', '实例 (A)')).toBe(false);
  expect(refersTo('    ' + link, 'jar', id)).toBe(false);
  expect(refersTo('`' + link + '`', 'jar', id)).toBe(false);
});

it('locates matching paragraphs, distinguishes repeated headings, and recognizes section backlinks', () => {
  const body = '## 验证\n\n第一段\n\n## 验证\n\n核对目标端口';
  const { headings, html } = articleLayout(body);
  expect(headings[0].key).not.toBe(headings[1].key);
  expect(html).toContain('data-kb-line="6"');
  expect(bodyMatch(body, '端口')).toEqual({ line: 6, snippet: '核对目标端口' });
  expect(
    refersTo(referenceText('knowledge', 'article~' + headings[1].key, '验证'), 'knowledge', 'article'),
  ).toBe(true);
});

it('renders formatted text offline and keeps raw HTML as article text', () => {
  const html = renderArticle('## 准备\n\n**配置** <em>示例</em> ![图示](https://example.com/image.png)');
  expect(html).toContain('<h2>准备</h2>');
  expect(html).toContain('<strong>配置</strong>');
  expect(html).toContain('&lt;em&gt;');
  expect(html).not.toContain('<img');
});

it('locates an exact Linux command heading before incidental mentions in a chapter', () => {
  expect(bodyMatch('## lsblk\n\nls also lists files.\n\n## ls\n\n列出文件', 'ls', true)).toMatchObject({ heading: true, line: 4 });
  expect(refersTo(referenceText('dev-docs', 'linux-files~h2', 'ls'), 'dev-docs', 'linux-files')).toBe(true);
});
