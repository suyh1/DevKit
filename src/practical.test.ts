import { describe, expect, it, vi } from 'vitest';
import { applyPatch } from 'diff';
import { transform } from './tools';
import type { Options } from './tools';

describe('practical offline tools', () => {
  it('converts YAML structures with exact large integers and literal strings', async () => {
    const yaml = 'id: 9007199254740993\nname: 中文\nactive: true\nempty: null\nitems: [1, 2]\ndate: 2026-10-22\n';
    const json = await transform('yaml', yaml);
    expect(json).toContain('9007199254740993');
    expect(JSON.parse(json).date).toBe('2026-10-22');
    const encoded = await transform('yaml', json, { mode: 'json-yaml' });
    expect(encoded).toContain('9007199254740993');
    expect(await transform('yaml', encoded)).toBe(json);
    expect(await transform('yaml', '[1,true,"中文"]', { mode: 'json-yaml' })).toContain('中文');
  });
  it('rejects duplicate keys, non-JSON values, cycles, aliases and excessive depth', async () => {
    for (const yaml of ['a: 1\na: 2', 'a: .inf', 'a: .nan', 'a: !unknown value', '1: value', '&a [*a]', 'a: 1\n---\nb: 2', ' '.repeat(0)]) {
      await expect(transform('yaml', yaml)).rejects.toThrow();
    }
    await expect(transform('yaml', '['.repeat(105) + '0' + ']'.repeat(105))).rejects.toThrow('100');
    await expect(transform('yaml', '{"id":1,"id":2}', { mode: 'json-yaml' })).rejects.toThrow();
    expect(JSON.parse(await transform('yaml', 'base: &a [one, two]\ncopy: *a')).copy).toEqual(['one', 'two']);
  });
  it('parses quoted commas, CRLF, BOM, escaped quotes and multiline fields', async () => {
    const result = await transform('csv-json', '\uFEFFname,note,id\r\nAlice,"a,b",001\r\nBob,"line1\nline2 ""yes""",002\r\n');
    expect(JSON.parse(result)).toEqual([{ name: 'Alice', note: 'a,b', id: '001' }, { name: 'Bob', note: 'line1\nline2 "yes"', id: '002' }]);
    expect(JSON.parse(await transform('csv-json', 'a\tb\n1\t2', { delimiter: 'tab', headers: 'none' }))).toEqual([['a', 'b'], ['1', '2']]);
    expect(JSON.parse(await transform('csv-json', 'a,b\n"",\n'))).toEqual([{ a: '', b: '' }]);
  });
  it('infers only safe numeric values and keeps IDs and large integers as strings', async () => {
    const json = await transform('csv-json', 'id,big,value,flag,empty\n001,9007199254740993,2.5,true,null', { types: 'infer' });
    expect(JSON.parse(json)).toEqual([{ id: '001', big: '9007199254740993', value: 2.5, flag: true, empty: null }]);
    const proto = JSON.parse(await transform('csv-json', '__proto__,constructor\nhello,world'));
    expect(Object.hasOwn(proto[0], '__proto__')).toBe(true);
    expect(proto[0].__proto__).toBe('hello');
  });
  it('rejects malformed CSV instead of dropping data', async () => {
    for (const csv of ['a,a\n1,2', ',b\n1,2', 'a,b\n1', 'a\n"unterminated', 'a\n"x"oops', 'a\nx"y', '']) await expect(transform('csv-json', csv)).rejects.toThrow();
  });
  it('formats all offered SQL dialects while preserving string literals and comments', async () => {
    for (const dialect of ['sql', 'mysql', 'postgresql', 'sqlite', 'transactsql', 'plsql']) {
      const formatted = await transform('sql', "select id,name from users where name='a  b' -- keep comment\norder by id;", { dialect });
      expect(formatted).toContain('SELECT'); expect(formatted).toContain("'a  b'"); expect(formatted).toContain('-- keep comment'); expect(formatted).toContain('\n');
    }
    expect(await transform('sql', 'SELECT id FROM users', { keywordCase: 'lower' })).toContain('select');
    await expect(transform('sql', 'select 1', { dialect: 'bad' })).rejects.toThrow();
    await expect(transform('sql', '')).rejects.toThrow();
  });
  it('creates applicable patches including Unicode, CRLF, empty sides and final newline changes', async () => {
    for (const [old, changed] of [['a\nb\n', 'a\nc\n'], ['中文\r\n', '修改\r\n'], ['', 'new'], ['delete', ''], ['same', 'same\n']]) {
      const patch = await transform('diff', old, { target: changed });
      expect(applyPatch(old, patch)).toBe(changed);
    }
    expect(await transform('diff', ' a \n', { target: 'a\n', ignoreWhitespace: 'on' })).not.toContain('@@');
    await expect(transform('diff', '', { target: 'x'.repeat(500_001) })).rejects.toThrow();
  });
  it('parses repeated parameters, percent encoding, IPv6 and fragments without requests', async () => {
    const parsed = JSON.parse(await transform('url-inspect', 'https://[::1]:8443/a?tag=java&tag=ts&q=%E4%B8%AD%E6%96%87+ok&empty=#part'));
    expect(parsed.hostname).toBe('[::1]'); expect(parsed.port).toBe('8443'); expect(parsed.hash).toBe('#part');
    expect(parsed.query).toEqual([{ name: 'tag', value: 'java' }, { name: 'tag', value: 'ts' }, { name: 'q', value: '中文 ok' }, { name: 'empty', value: '' }]);
    await expect(transform('url-inspect', '/relative')).rejects.toThrow('完整');
  });
  it('generates valid password lengths, counts, character classes and ambiguity exclusions', async () => {
    const results = (await transform('password', '', { length: '24', count: '40' })).split('\n');
    expect(results).toHaveLength(40); expect(new Set(results).size).toBe(40);
    for (const result of results) {
      expect(result).toHaveLength(24); expect(result).not.toMatch(/[Il1O0o]/);
      expect(result).toMatch(/[a-z]/); expect(result).toMatch(/[A-Z]/); expect(result).toMatch(/[2-9]/); expect(result).toMatch(/[^a-zA-Z0-9]/);
    }
    expect(await transform('password', '', { charset: 'hex', length: '256', count: '1', ambiguous: 'keep' })).toMatch(/^[0-9a-f]{256}$/);
    expect(await transform('password', '', { charset: 'alnum', length: '24', count: '1' })).toMatch(/^[a-zA-Z2-9]{24}$/);
    const invalid: Options[] = [{ length: '3' }, { length: '257' }, { count: '0' }, { count: '101' }, { length: '4.5' }, { charset: 'bad' }];
    for (const options of invalid) await expect(transform('password', '', options)).rejects.toThrow();
  });
  it('rejects biased random values before selecting a character', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    let calls = 0;
    spy.mockImplementation(array => { (array as Uint32Array).fill(calls++ === 0 ? 0xffffffff : 0); return array; });
    try {
      expect(await transform('password', '', { charset: 'digits', ambiguous: 'keep', length: '4', count: '1' })).toBe('0000');
      expect(calls).toBe(5);
    } finally { spy.mockRestore(); }
  });
});
