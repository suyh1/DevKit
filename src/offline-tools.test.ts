import { describe, it, expect } from 'vitest';
import { defaultOptions, transform } from './tools';
import { createTask, changeToolOption, importWorkspace, workspaceSnapshot } from './workbench';
import { parseCsv } from './practical';
import { replaceMatches } from './regex-replace';

describe('offline data and design tools', () => {
  it('validates samples, including local refs, invalid definitions and indeterminate results', async () => {
    const sample = '[{"count":1},{"count":2}]';
    const schema = await transform('json-schema', sample);
    const task = { ...createTask('json-schema', '2', sample), output: schema, status: 'success' as const };
    const options = changeToolOption(task, 'mode', 'validate').options!;
    expect(options.schema).toBe(schema);
    expect(await transform('json-schema', sample, options)).toBe('校验通过');
    expect(await transform('json-schema', '[{"count":1},{"count":"bad"}]', options)).toMatch(/样本不合规[\s\S]*1\/count/);
    const check = (schema: string, body = '1') => transform('json-schema', body, { mode: 'validate', schema });
    await expect(check('{"type":"bad"}')).rejects.toThrow('Schema 定义无效');
    await expect(check('{')).rejects.toThrow('Schema 定义无效');
    await expect(check('true', 'not-json')).rejects.toThrow('样本格式无效');
    expect(await check('{"$ref":"#/$defs/int","$defs":{"int":{"type":"integer"}}}')).toBe('校验通过');
    expect(await check('{"$dynamicRef":"#x"}')).toContain('无法判定');
    expect(await check('{"$ref":"https://example.org/schema"}')).toContain('无法判定');
    expect(await check('true', '9007199254740993')).toContain('无法判定');
  });
  it('round trips both diff file sources through workspace export and restore', () => {
    const task = createTask('diff');
    Object.assign(task, { input: 'first', fileName: 'left.json', encoding: 'UTF-8' });
    Object.assign(task.options, { target: 'second', targetFileName: 'right.json', targetEncoding: 'UTF-16LE' });
    expect(importWorkspace(workspaceSnapshot([task], task.id)).tasks[0]).toMatchObject({
      input: 'first', fileName: 'left.json', encoding: 'UTF-8', options: task.options,
    });
  });
  it('matches native JS replacement semantics, including astral zero-width matches and empty output', () => {
    for (const [input, re, replacement, count] of [
      ['张,三', /(?<姓>[^,]+),(.+)/, '$2 $<姓>', 1], ['abc', /./, '', 1], ['abc', /./g, '', 3],
      ['😄a', /(?:)/gu, 'X', 3], ['aab', /(a)/g, "$$:$01:$10:$99:$&:$\x60:$'", 2],
      ['ABC', /([a-z])/g, '$1', 0],
    ] as const) expect(replaceMatches(input, re, replacement)).toEqual({ text: input.replace(re, replacement), count });
  });
  it('compares decoded env values by key and reports the source of duplicate keys', async () => {
    const compare = (left: string, right: string) => transform('env', left, { mode: 'compare', target: right });
    expect(JSON.parse(await compare('A=\nB=secret\nC=1', 'C="1" # comment\n B=changed\nD=')))
      .toEqual({ '仅左侧': ['A'], '仅右侧': ['D'], '值有变化': ['B'] });
    expect(JSON.parse(await compare('A=1\nB=', '# note\nB=""\nA=1'))['值有变化']).toEqual([]);
    await expect(compare('', 'A=1\nA=2')).rejects.toThrow(/右侧.*第 2 行/);
    await expect(compare('A=1\nA=2', '')).rejects.toThrow(/左侧.*第 2 行/);
  });
  it('keeps invalid timestamp rows and projects UTC instants across daylight saving changes', async () => {
    const options = { unit: 'ms', mode: 'batch', zone: 'America/New_York' };
    const rows = parseCsv(await transform('timestamp', '1735689600000\r\nbad\n1751328000000', options), '\t');
    expect(rows[1][1]).toMatch(/2024-12-31.*19:00:00.*05:00/);
    expect(rows[2]).toMatchObject(['bad', '', expect.stringContaining('时间戳')]);
    expect(rows[3][1]).toMatch(/2025-06-30.*20:00:00.*04:00/);
    await expect(transform('timestamp', '0', { ...options, zone: 'bad/zone' })).rejects.toThrow('IANA');
  });
  it('round trips NDJSON numeric tokens, whitespace in strings and LF or CRLF boundaries', async () => {
    const lines = '{"id":9007199254740993,"s":" a  b "}\n1.20e+3\nnull\n';
    const array = await transform('json-lines', lines.replaceAll('\n', '\r\n'));
    expect(await transform('json-lines', array, { mode: 'lines' })).toBe(lines);
    expect(await transform('json-lines', '1\n\n2')).toBe('[1,\n2]');
    await expect(transform('json-lines', '1\n\n2', { blank: 'error' })).rejects.toThrow('第 2 行');
    await expect(transform('json-lines', '1\n\nx')).rejects.toThrow('第 3 行');
    expect(await transform('json-lines', '[]', { mode: 'lines' })).toBe('');
  });
  it('preserves quoted CSV/TSV, delimiters, literal HTML and empty fields in Markdown round trips', async () => {
    for (const delimiter of [',', '\t']) {
      const rows = [['编号', '备注'], ['001', 'a|b\\c'], ['', 'line one\nline two'], ['003', '"quote",<br>&lt;'], ['004',' padded ']];
      const input = rows.map(row => row.map(v => '"' + v.replaceAll('"','""') + '"').join(delimiter)).join('\n');
      const options = { delimiter: delimiter === '\t' ? 'tab' : 'comma' };
      const md = await transform('markdown-table', input, options);
      expect(md).toContain('a\\|b');
      const csv = await transform('markdown-table', md, { ...options, mode: 'delimited' });
      expect(parseCsv(csv, delimiter)).toEqual(rows);
    }
  });
  it('sorts npm versions and reports invalid lines without losing valid results', async () => {
    const report = JSON.parse(await transform('semver', '1.2.3\n1.5.0-beta.1\n2.0.0\nbad\n1.4.0', { range: '^1.2.3' }));
    expect(report['匹配（降序）']).toEqual(['1.4.0','1.2.3']);
    expect(report['最高匹配版本']).toBe('1.4.0');
    expect(report['无效行']).toEqual(['第 4 行 · bad']);
    await expect(transform('semver', '1.4.0', { range: '^oops' })).rejects.toThrow('范围');
  });
  it('validates restored visual tool options and oversized QR data', async () => {
    await expect(transform('qr-code', '文'.repeat(2000), defaultOptions['qr-code'])).rejects.toThrow('容量');
    await expect(transform('css-flex', '', { width: 'NaN' })).rejects.toThrow('宽度');
    await expect(transform('css-flex', '', { direction: '<bad>' })).rejects.toThrow('布局参数');
  });
});
