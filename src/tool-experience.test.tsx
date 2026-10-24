import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { tools, defaultOptions, transform } from './tools';
import { digestMatches, experienceFor, permissionValue, toolExperiences } from './tool-experience';
import ToolResult from './ToolResult';

describe('tool workflows', () => {
  it('covers every registered tool and keeps mode-dependent ULID workflows usable', () => {
    expect(Object.keys(toolExperiences).sort()).toEqual(tools.map(tool => tool.id).sort());
    expect(experienceFor('ulid', { mode: 'generate' }).workflow).toBe('generate');
    expect(experienceFor('ulid', { mode: 'parse' }).workflow).toBe('inspect');
  });
  it('preserves special permission bits when switching between symbolic and checkbox input', async () => {
    for (const input of ['rwsr-xr-x', 'rwSr-Sr-T', '-rwxrwxrwt', '4755', '0000', '7777']) {
      const value = permissionValue(input)!;
      expect(value).not.toBeNull();
      const result = JSON.parse(await transform('chmod', input));
      expect(value.toString(8).padStart(4, '0')).toBe(result.octal);
    }
    expect(permissionValue('rwx')).toBeNull();
    expect(permissionValue('888')).toBeNull();
  });
  it('compares HEX without case sensitivity and Base64 with case sensitivity', () => {
    expect(digestMatches('aB01', ' AB01 ', 'hex')).toBe(true);
    expect(digestMatches('aB01', 'Ab01', 'base64')).toBe(false);
    expect(digestMatches('aB01', '', 'hex')).toBeNull();
    expect(digestMatches('', 'ab01', 'hex')).toBeNull();
  });
  it('renders actual domain outputs and escapes untrusted text in every specialized result', async () => {
    for (const id of ['http-status', 'ipv4', 'chmod', 'cron', 'text-stats', 'url-inspect', 'jwt', 'ulid', 'timestamp', 'radix', 'css-unit', 'json-csv', 'hash', 'hmac', 'csv-json', 'regex', 'diff'] as const) {
      const tool = tools.find(tool => tool.id === id)!;
      const options = { ...defaultOptions[id], ...(id === 'hmac' ? { key: 'test' } : {}), ...(id === 'ulid' ? { mode: 'parse' } : {}), ...(id === 'cron' ? { start: '2026-01-01T00:00:00Z' } : {}) };
      const input = id === 'ulid' ? '01ARZ3NDEKTSV4RRFFQ69G5FAV' : tool.sample;
      const text = await transform(id, input, options);
      const markup = renderToStaticMarkup(<ToolResult id={id} text={text} source={input} options={options} expected="" onExpected={() => {}} onCopy={() => {}} />);
      expect(markup.length, id).toBeGreaterThan(50);
      expect(markup, id).not.toContain('无法生成预览');
    }
    const markup = renderToStaticMarkup(<ToolResult id="http-status" text={JSON.stringify([{ code: 200, name: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' }])} source="" options={{}} expected="" onExpected={() => {}} onCopy={() => {}} />);
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
  });
  it('keeps quoted CSV cells, multiline text and large integer strings intact in table preview', async () => {
    const source = '[{"id":"9007199254740993","note":"a, b\\nnext"}]';
    const text = await transform('json-csv', source, defaultOptions['json-csv']);
    const markup = renderToStaticMarkup(<ToolResult id="json-csv" text={text} source={source} options={defaultOptions['json-csv']} expected="" onExpected={() => {}} onCopy={() => {}} />);
    expect(markup).toContain('9007199254740993');
    expect(markup).toContain('a, b\nnext');
  });
});
