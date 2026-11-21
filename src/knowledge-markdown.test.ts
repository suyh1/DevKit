import { expect, it } from 'vitest';
import { referenceText, refersTo, renderArticle } from './knowledge-markdown';

it('matches the exact host-qualified resource and ignores examples and plain text', () => {
  const id = 'host:实例 (A)';
  const link = referenceText('jar', id, '订单 [主] 服务');
  expect(refersTo(link, 'jar', id)).toBe(true);
  expect(refersTo(link, 'nginx', id)).toBe(false);
  expect(refersTo(link, 'jar', '实例 (A)')).toBe(false);
  expect(refersTo('    ' + link, 'jar', id)).toBe(false);
  expect(refersTo('`' + link + '`', 'jar', id)).toBe(false);
});

it('renders formatted text offline and keeps raw HTML as article text', () => {
  const html = renderArticle('## 准备\n\n**配置** <em>示例</em> ![图示](https://example.com/image.png)');
  expect(html).toContain('<h2>准备</h2>');
  expect(html).toContain('<strong>配置</strong>');
  expect(html).toContain('&lt;em&gt;');
  expect(html).not.toContain('<img');
});
