import { describe, expect, it } from 'vitest';
import { tools, transform, defaultOptions } from './tools';

describe('additional offline utilities', () => {
  it('runs every tool sample with defaults and an explicit test-only HMAC key', async () => {
    expect(tools).toHaveLength(45);
    for (const tool of tools) expect(await transform(tool.id, tool.sample, { ...defaultOptions[tool.id], ...(tool.id === 'hmac' ? { key: 'test-only-key' } : {}) }), tool.id).toBeTruthy();
  });
  it('decodes JWT fields and NumericDate claims without claiming verification', async () => {
    const token = tools.find(tool => tool.id === 'jwt')!.sample;
    const decoded = JSON.parse(await transform('jwt', token));
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.name).toBe('Alice');
    expect(decoded.dates.iat).toBe('2025-01-01T00:00:00.000Z');
    expect(decoded.notice).toContain('未验证');
    await expect(transform('jwt', 'bad.token')).rejects.toThrow();
    await expect(transform('jwt', '%%.e30.sig')).rejects.toThrow();
  });
  it('converts big signed integers exactly and validates input digits', async () => {
    expect(await transform('radix', '9007199254740993')).toBe('20000000000001');
    expect(await transform('radix', '-0xff', { from: '16', to: '2' })).toBe('-11111111');
    expect(await transform('radix', '20000000000001', { from: '16', to: '10' })).toBe('9007199254740993');
    for (const value of ['2', '', '0xff', '10.5']) await expect(transform('radix', value, { from: '2' })).rejects.toThrow();
  });
  it('transforms naming conventions and line-oriented text', async () => {
    expect(await transform('text', 'HTTPResponseCode\nuser_profile_name')).toBe('httpResponseCode\nuserProfileName');
    expect(await transform('text', 'HTTPResponseCode', { mode: 'snake' })).toBe('http_response_code');
    expect(await transform('text', 'hello-world', { mode: 'pascal' })).toBe('HelloWorld');
    expect(await transform('text', 'a\r\na\r\nb', { mode: 'dedupe' })).toBe('a\nb');
    expect(await transform('text', ' a \n \n b ', { mode: 'trim' })).toBe('a\nb');
    expect(await transform('text', 'item10\nitem2', { mode: 'sort' })).toBe('item2\nitem10');
  });
  it('round-trips HTML special characters and decodes Unicode entities once', async () => {
    const input = '<b title="x">A & B\'s</b>';
    expect(await transform('html', await transform('html', input), { mode: 'decode' })).toBe(input);
    expect(await transform('html', '&#x1F604;&#20320;&amp;lt;&unknown;', { mode: 'decode' })).toBe('😄你&lt;&unknown;');
    expect(await transform('html', '&#xD800;&#1114112;', { mode: 'decode' })).toBe('��');
  });
  it('exports CSV with merged columns, quoting, missing cells and formula escaping', async () => {
    const output = await transform('json-csv', '[{"name":"A,B","note":"a\\"b","nested":{"ok":true}},{"name":"=1+1","extra":2}]');
    expect(output).toBe('name,note,nested,extra\r\n"A,B","a""b","{""ok"":true}",\r\n\'=1+1,,,2');
    expect(await transform('json-csv', '[{"x":"=1+1"}]', { excelSafe: 'off', delimiter: 'tab' })).toBe('x\r\n=1+1');
    await expect(transform('json-csv', '[{"id":9007199254740993}]')).rejects.toThrow('安全精度');
    await expect(transform('json-csv', '{"a":1}')).rejects.toThrow('对象数组');
  });
});

