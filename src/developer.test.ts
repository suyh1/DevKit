import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { transform, defaultOptions } from './tools';
import type { ToolId, Options } from './tools';
import { createTask, importWorkspace, workspaceSnapshot } from './workbench';
import { developerPresentation } from './tool-presentation';
import { searchTools } from './discovery';

const run = (id: ToolId, input: string, options: Options = {}) => transform(id, input, { ...defaultOptions[id], ...options });
describe('frontend and backend tools', () => {
  it.each([
    ['babel', 'const x={name:"你好"}', "name: '你好'"],
    ['typescript', 'type User={id:number;name:string}', 'id: number;'],
    ['typescript', 'const App=()=> <div>Hello</div>', '<div>Hello</div>'],
    ['html', '<main><h1>Hello</h1><p>Hi</p></main>', '\n  <h1>Hello</h1>'],
    ['css', '.card{display:flex;color:red}', 'display: flex;'],
    ['scss', '$x:red;.a{color:$x;&:hover{opacity:.5}}', '&:hover'],
  ])('formats %s locally using real language parsers', async (language, input, expected) => {
    const output = await run('code-format', input, { language });
    expect(output).toContain(expected);
    expect(await run('code-format', output, { language })).toBe(output);
  });
  it('rejects invalid code and size rather than corrupting input', async () => {
    await expect(run('code-format', 'const =')).rejects.toThrow();
    await expect(run('code-format', 'x'.repeat(200_001))).rejects.toThrow('200,000');
    await expect(run('code-format', '', { language: 'unknown' })).rejects.toThrow();
  });
  it('selects quoted keys, arrays and wildcards without rounding numeric lexemes', async () => {
    const input = '{"a.b":[{"id":9007199254740993},{"id":1e400}],"__proto__":{"id":4}}';
    expect(await run('json-path', input, { path: '$["a.b"][*].id' })).toBe('[\n9007199254740993,\n1e400\n]');
    expect(JSON.parse(await run('json-path', input, { path: '$.__proto__.id' }))).toEqual([4]);
    expect(await run('json-path', input, { path: '$.missing' })).toBe('[]');
    expect(await run('json-path', '{"0":1}', { path: '$[0]' })).toBe('[]');
    await expect(run('json-path', input, { path: '$..id' })).rejects.toThrow();
    await expect(run('json-path', input, { path: '$[?(@.id)]' })).rejects.toThrow();
  });
  it('infers schema across all array samples, optional fields, empty arrays and numeric unions', async () => {
    const schema = JSON.parse(await run('json-schema', '[{"id":1,"tag":null},{"id":2.5,"name":"x"}]'));
    expect(schema.$schema).toContain('2020-12');
    expect(schema.items.required).toEqual(['id']);
    expect(schema.items.properties.id).toEqual({ type: 'number' });
    expect(schema.items.properties.tag).toEqual({ type: 'null' });
    expect(JSON.parse(await run('json-schema', '[]')).items).toEqual({});
    expect(JSON.parse(await run('json-schema', '[1,"x",null]')).items.anyOf).toHaveLength(3);
    expect(JSON.parse(await run('json-schema', '{"__proto__":1}')).properties.__proto__).toEqual({ type: 'integer' });
  });
  it('roundtrips query duplicates, empty strings, literal plus and prototype keys', async () => {
    const input = '{"tag":["java","react"],"q":"a+b 中文","empty":"","__proto__":"safe"}';
    const encoded = await run('query-string', input, { mode: 'encode' });
    expect(encoded).toContain('tag=java&tag=react');
    expect(JSON.parse(await run('query-string', encoded))).toEqual(JSON.parse(input));
    expect(JSON.parse(await run('query-string', '?q=hello+world')).q).toBe('hello world');
    for (const value of ['x=%ZZ', 'x=%FF', 'https://example.com?a=1']) await expect(run('query-string', value)).rejects.toThrow();
    await expect(run('query-string', '{"x":1}', { mode: 'encode' })).rejects.toThrow();
  });
  it('generates request code without executing it and safely quotes shell values', async () => {
    const input = JSON.stringify({ method: 'POST', url: 'https://example.com', headers: { 'Content-Type': 'application/json' }, body: { name: "O'Reilly\n中文" } });
    const fetch = await run('http-code', input);
    expect(fetch).toContain('await fetch('); expect(fetch).toContain('if (!response.ok)');
    // Parse generated JS to catch escaping mistakes; constructing the function does not run it.
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    expect(() => new AsyncFunction(fetch)).not.toThrow();
    for (const method of ['GET', 'HEAD']) {
      const empty = await run('http-code', JSON.stringify({method,url:'https://example.com',body:''}));
      expect(empty).not.toContain('\"body\"');
    }
    const curl = await run('http-code', input, { style: 'curl' });
    expect(curl).toContain("O'\\''Reilly"); expect(curl).toContain('--data-raw');
    const axios = await run('http-code', input, { style: 'axios' });
    expect(axios).toContain('axios.request('); expect(axios).toContain('"data"');
    for (const config of [{ url: 'file:///tmp/x' }, { url: 'https://example.com', body: 'x' }, { url: 'https://a:b@example.com' }, { url: 'https://example.com', headers: { x: 'a\r\nb' } }]) await expect(run('http-code', JSON.stringify(config))).rejects.toThrow();
  });
  it('calculates exact UTC cron times, step/range/list, Sunday alias and day/week OR', async () => {
    const options = { start: '2026-10-23T23:59:00Z', count: '3' };
    expect(JSON.parse(await run('cron', '*/15 * * * *', options)).matches).toEqual(['2026-10-24T00:00:00.000Z', '2026-10-24T00:15:00.000Z', '2026-10-24T00:30:00.000Z']);
    expect(JSON.parse(await run('cron', '0 0 * * 7', { ...options, count: '1' })).matches[0]).toBe('2026-10-25T00:00:00.000Z');
    expect(JSON.parse(await run('cron', '0 0 1 * 1', options)).matches[0]).toBe('2026-10-26T00:00:00.000Z');
    expect(JSON.parse(await run('cron', '0,30 9-10 * * 1-5', { start: '2026-10-23T09:00:00+08:00', count: '1' })).matches[0]).toBe('2026-10-23T09:00:00.000Z');
    expect(JSON.parse(await run('cron', '0 0 29 2 *', { start: '2026-01-01T00:00:00Z', count: '1' })).matches[0]).toBe('2028-02-29T00:00:00.000Z');
  });
  it('bounds impossible cron schedules and rejects invalid calendars and Quartz syntax', async () => {
    const impossible = JSON.parse(await run('cron', '0 0 31 2 *', { start: '2026-01-01T00:00:00Z', count: '1' }));
    expect(impossible.matches).toEqual([]); expect(impossible.complete).toBe(false);
    for (const cron of ['* * * * * *', '*/0 * * * *', '60 * * * *', '0 0 * * MON', '0 0 ? * 1', '0 0 1 13 *']) await expect(run('cron', cron)).rejects.toThrow();
    for (const start of ['2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T24:00:00Z']) await expect(run('cron', '* * * * *', { start })).rejects.toThrow();
  });
  it('converts env values losslessly without expansion and rejects ambiguous input', async () => {
    const value = { X: '汉字\n"\\#', EMPTY: '', REF: '${SECRET}', CMD: '$(whoami)' };
    expect(JSON.parse(await run('env', await run('env', JSON.stringify(value), { mode: 'encode' })))).toEqual(value);
    expect(JSON.parse(await run('env', 'export X = \'#literal\' # comment\nN=001 # keep string\n'))).toEqual({ X: '#literal', N: '001' });
    for (const value of ['X=1\nX=2', '1BAD=x', 'X="unclosed']) await expect(run('env', value)).rejects.toThrow();
    await expect(run('env', '{"N":2}', { mode: 'encode' })).rejects.toThrow();
  });
  it('roundtrips Java properties escapes, separators, Unicode and continuation', async () => {
    const value = { 'a b:c=d': ' leading\n汉字😄\\', '__proto__': 'value', '': '' };
    expect(JSON.parse(await run('properties', await run('properties', JSON.stringify(value), { mode: 'encode' })))).toEqual(value);
    expect(JSON.parse(await run('properties', 'a\\ b : hello\\\n  world\nnoValue\nwelcome=\\u4f60\\u597d\n'))).toEqual({ 'a b': 'helloworld', noValue: '', welcome: '你好' });
    expect(JSON.parse(await run('properties', 'url=https://example.com?a=b\nvalue=one\\=two'))).toEqual({ url: 'https://example.com?a=b', value: 'one=two' });
    await expect(run('properties', 'x=\\uZZZZ')).rejects.toThrow();
    await expect(run('properties', 'x=1\nx=2')).rejects.toThrow();
  });
  it.each(['SHA-256', 'SHA-384', 'SHA-512'])('matches independent %s HMAC vectors in HEX and Base64', async algorithm => {
    const key = '密钥 🔑', text = '中文 payload';
    const expected = createHmac(algorithm.replace('-', '').toLowerCase(), key).update(text);
    expect(await run('hmac', text, { key, algorithm })).toBe(expected.digest('hex'));
    expect(await run('hmac', text, { key, algorithm, format: 'base64' })).toBe(createHmac(algorithm.replace('-', '').toLowerCase(), key).update(text).digest('base64'));
    await expect(run('hmac', text)).rejects.toThrow('密钥');
  });
  it('roundtrips Unicode supplementary code points, escapes, newlines and rejects bad sequences', async () => {
    const text = '中文😄 \\u1234\n';
    expect(await run('unicode', await run('unicode', text), { mode: 'decode' })).toBe(text);
    expect(await run('unicode', '\\u{1f604}', { mode: 'decode' })).toBe('😄');
    for (const value of ['\\uZZZZ', '\\u{110000}', '\\u123']) await expect(run('unicode', value, { mode: 'decode' })).rejects.toThrow();
  });
  it('converts CSS units with configured viewport/base and checks input units', async () => {
    expect(await run('css-unit', '16px\n-8px\n1.5')).toBe('1rem\n-0.5rem\n0.09375rem');
    expect(await run('css-unit', '10vw', { from: 'vw', to: 'px', viewport: '375' })).toBe('37.5px');
    expect(await run('css-unit', '2em', { from: 'em', to: 'px', base: '18' })).toBe('36px');
    for (const value of ['calc(1rem + 2px)', '2rem', 'Infinity', '']) await expect(run('css-unit', value)).rejects.toThrow();
    await expect(run('css-unit', '1', { base: '0' })).rejects.toThrow();
  });
  it('queries common HTTP status by code, name and Chinese text', async () => {
    expect(JSON.parse(await run('http-status', '404'))[0].name).toBe('Not Found');
    expect(JSON.parse(await run('http-status', 'timeout')).map((row: { code: number }) => row.code)).toEqual([408, 504]);
    expect(JSON.parse(await run('http-status', '重定向')).length).toBeGreaterThan(1);
    await expect(run('http-status', '999')).rejects.toThrow();
  });
  it('keeps HMAC secrets out of default workspace snapshots and restores only on opt-in', () => {
    const task = { ...createTask('hmac'), options: { ...defaultOptions.hmac, key: 'secret' }, output: 'signature' };
    expect(workspaceSnapshot([task], task.id)).not.toContain('secret');
    expect(importWorkspace(workspaceSnapshot([task], task.id, true)).tasks[0].options.key).toBe('secret');
  });
  it('uses mode-specific examples, export extensions, previews and search aliases', async () => {
    for (const id of ['env', 'properties', 'query-string', 'unicode'] as ToolId[]) {
      const options = { ...defaultOptions[id], mode: id === 'unicode' ? 'decode' : 'encode' };
      const presentation = developerPresentation(id, options)!;
      expect(await run(id, presentation.sample!, options)).toBeTruthy();
    }
    expect(developerPresentation('http-code', { style: 'curl' })?.extension).toBe('sh');
    expect(developerPresentation('env', { mode: 'decode' })?.preview).toBe(true);
    expect(searchTools('prettier')[0].id).toBe('code-format');
    expect(searchTools('crontab')[0].id).toBe('cron');
    expect(searchTools('axios')[0].id).toBe('http-code');
  });
});
