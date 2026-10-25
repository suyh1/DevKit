import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HttpRequestInput from './HttpRequestInput';

describe('HTTP input initial and malformed drafts', () => {
  const render = (value: string, advanced = false) =>
    renderToStaticMarkup(<HttpRequestInput value={value} advanced={advanced} disabled={false} onChange={() => {}} wrap tabSize={2} />);
  it('opens an empty code-generator task without parsing an empty source as JSON', () => {
    expect(render('')).toContain('请求 URL');
    expect(render('')).toContain('Body · 预览');
    expect(render('', true)).toContain('请求编辑区域');
  });
  it('keeps malformed config and invalid headers in the source editor for correction', () => {
    expect(render('{', true)).toContain('请先在配置 JSON 中修正');
    expect(render('{"headers":{"X-Test":42}}', true)).toContain('请求头值必须为字符串');
  });
});
