import { describe, expect, it } from 'vitest';
import { basicAuthorization, queryRows, withAuthorization, withHeaderRows, withHttpBody, withQueryRows } from './http-builder';
import { parseHttpConfig } from './http-model';
import { formatJson } from './tools';

describe('HTTP request editing', () => {
  const config =
    '{"method":"POST","url":"http://localhost/api?tag=a&tag=b#part","headers":{"X-App":"test"},"body":{"id":9007199254740993,"n":1e+30}}';
  it('retains duplicate query keys, Unicode, empty values, fragments and disabled rows', () => {
    const rows = [
      ...queryRows('http://localhost/?tag=a&tag=b&empty='),
      { key: '中文', value: 'a + b&c', enabled: true },
      { key: 'skip', value: '1', enabled: false }
    ];
    const url = withQueryRows('http://localhost/api?old=1#part', rows);
    expect(url).toBe('http://localhost/api?tag=a&tag=b&empty=&%E4%B8%AD%E6%96%87=a+%2B+b%26c#part');
    expect(queryRows(url).map((row) => [row.key, row.value])).toEqual([
      ['tag', 'a'],
      ['tag', 'b'],
      ['empty', ''],
      ['中文', 'a + b&c']
    ]);
  });
  it('changes headers and authorization without rewriting body tokens', () => {
    const updated = withAuthorization(
      withHeaderRows(config, [
        { key: 'X-Test', value: 'ok', enabled: true },
        { key: 'Skip', value: 'x', enabled: false }
      ]),
      'Bearer token'
    );
    expect(parseHttpConfig(updated).headers).toMatchObject({ 'X-Test': 'ok', Authorization: 'Bearer token' });
    expect(parseHttpConfig(updated).body).toBe('{"id":9007199254740993,"n":1e+30}');
    expect(parseHttpConfig(withAuthorization(updated, '')).headers.Authorization).toBeUndefined();
    expect(() =>
      withHeaderRows(config, [
        { key: 'X-Test', value: 'a', enabled: true },
        { key: 'x-test', value: 'b', enabled: true }
      ])
    ).toThrow('重复');
  });
  it('supports UTF-8 Basic auth and rejects ambiguous usernames', () => {
    expect(
      new TextDecoder().decode(Uint8Array.from(atob(basicAuthorization('用户', '密:码').slice(6)), (char) => char.charCodeAt(0)))
    ).toBe('用户:密:码');
    expect(() => basicAuthorization('a:b', 'c')).toThrow('冒号');
  });
  it('preserves JSON numbers and supports raw invalid JSON, text and encoded forms', () => {
    const raw = '{"id":9007199254740993,"x":-0,"n":1e+30}';
    expect(parseHttpConfig(withHttpBody(config, raw, 'json')).body).toBe(raw);
    expect(parseHttpConfig(withHttpBody(config, '{incomplete', 'json')).body).toBe('{incomplete');
    expect(parseHttpConfig(withHttpBody(config, '"中文"', 'json')).body).toBe('"中文"');
    const text = parseHttpConfig(withHttpBody(config, 'line 1\n中文', 'text'));
    expect(text.body).toBe('line 1\n中文');
    expect(text.headers['Content-Type']).toBe('text/plain');
    const form = parseHttpConfig(withHttpBody(config, 'a=1&a=2', 'form'));
    expect(form.body).toBe('a=1&a=2');
    expect(form.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(parseHttpConfig(withHttpBody('{"url":"http://localhost","method":"POST"}', raw, 'json')).body).toBe(raw);
    expect(parseHttpConfig(withHttpBody(config, '', 'json')).body).toBe('');
    expect(formatJson(raw, { indent: '2' })).toContain('9007199254740993');
  });
});
