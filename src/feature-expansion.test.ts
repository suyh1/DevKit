import { describe, expect, it } from 'vitest';
import { transform, defaultOptions } from './tools';
import { parseCsv } from './practical';
import { compareProfiles } from './project-comparison';
import { initialState } from '../shared/projects.mjs';
import { parseHttpConfig, readHttpCollection, savedHttpConfig, collectionText } from './http-model';

describe('Mock data', () => {
  it('reproduces seeded Chinese records, varies rows and applies nested rules', async () => {
    const options = { ...defaultOptions['mock-data'], count: '20', rules: '{"id":"sequence","profile.city":"city","tags[]":{"kind":"pick","values":["甲","乙"]}}' };
    const input = '{"id":1,"name":"a","email":"a","profile":{"city":"a"},"tags":["a"]}';
    const a = await transform('mock-data', input, options), b = await transform('mock-data', input, options);
    expect(a).toBe(b); const rows = JSON.parse(a);
    expect(rows.map((row: { id: number }) => row.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(rows.map((row: { name: string }) => row.name)).size).toBeGreaterThan(1);
    expect(rows[0].name).toMatch(/[\u4e00-\u9fff]/);
    expect(await transform('mock-data', input, { ...options, seed: 'other' })).not.toBe(a);
    expect(parseCsv(await transform('mock-data', input, { ...options, format: 'csv' }), ',')).toHaveLength(21);
  });
  it('generates bounded Schema values and rejects unsupported claims', async () => {
    const schema = '{"type":"object","properties":{"age":{"type":"integer","minimum":18,"maximum":22},"code":{"type":"string","minLength":2,"maxLength":4},"tags":{"type":"array","minItems":2,"maxItems":3,"items":{"type":"boolean"}}}}';
    const options = { ...defaultOptions['mock-data'], source: 'schema' };
    const rows = JSON.parse(await transform('mock-data', schema, options));
    for (const row of rows) { expect(row.age).toBeGreaterThanOrEqual(18); expect(row.age).toBeLessThanOrEqual(22); expect(row.code.length).toBeGreaterThanOrEqual(2); expect(row.code.length).toBeLessThanOrEqual(4); expect(row.tags).toHaveLength(2); }
    await expect(transform('mock-data', '{"type":"string","pattern":"a+"}', options)).rejects.toThrow('不支持');
    await expect(transform('mock-data', '{}', { ...options, count: '1001' })).rejects.toThrow('数量');
    await expect(transform('mock-data', '{"name":"x"}', { ...defaultOptions['mock-data'], rules: '{"unknown":"name"}' })).rejects.toThrow('未匹配');
    await expect(transform('mock-data', '{"x":1,"x":2}', defaultOptions['mock-data'])).rejects.toThrow('重复');
    await expect(transform('mock-data', '{"type":"integer","minimum":"1"}', options)).rejects.toThrow('数字');
    await expect(transform('mock-data', '{"type":"string","const":3}', options)).rejects.toThrow('不兼容');
    await expect(transform('mock-data', '{"type":"integer","enum":[1,2],"minimum":2}', options)).rejects.toThrow('叠加');
    const negatives = JSON.parse(await transform('mock-data', '{"type":"integer","maximum":-1}', options));
    expect(negatives.every((value: number) => value <= -1)).toBe(true);
  });
});

describe('scheme comparison', () => {
  it('compares resolved URLs, empty/missing vars, independent projects and query variable names', () => {
    const state = initialState();
    state.profiles = [{ id: 'dev', name: '开发', description: '', variables: [{ key: 'host', value: 'localhost' }, { key: 'q', value: '' }], projects: [] }, { id: 'prod', name: '生产', description: '', variables: [{ key: 'host', value: 'example.com' }], projects: [] }];
    state.profiles[0].projects = [{ id: 'web', name: 'web', code: 'web', group: '', description: '', url: 'https://{{ host }}/', enabled: true, query: [{ id: 'query', key: '{{ q }}', value: 'a', enabled: true }] }];
    state.profiles[1].projects = state.profiles[0].projects.map(project => ({ ...structuredClone(project), enabled: false }));
    const report = compareProfiles(state, ['dev', 'prod']);
    expect(report.variables.find(row => row.key === 'q')?.values).toEqual(['', undefined]);
    expect(report.projects[0].different).toBe(true);
    expect(report.projects[0].values[1]?.missing).toEqual(['q']);
    expect(report.projects[0].values[1]?.enabled).toBe(false);
    expect(state.revision).toBe(0);
  });
});

describe('scheme alignment', () => {
  it('compares the union by code, reports absence and ignores internal IDs', () => {
    const state = initialState();
    const project = { id: 'a', code: 'same', name: '甲', group: '', description: '', url: 'https://example.test/', enabled: true, query: [] };
    state.profiles[0].projects = [project];
    state.profiles.push({ ...structuredClone(state.profiles[0]), id: 'b', name: '乙', projects: [{ ...project, id: 'different' }, { ...project, id: 'other', code: 'only-b' }] });
    let report = compareProfiles(state, ['default', 'b']);
    expect(report.projects[0].different).toBe(false);
    expect(report.projects[1].values[0]).toBeNull();
    expect(report.projects[1].different).toBe(true);
    state.profiles[1].projects[0].description = 'changed';
    report = compareProfiles(state, ['default', 'b']);
    expect(report.projects[0].different).toBe(true);
    expect(() => compareProfiles(state, ['default', 'default'])).toThrow('2–4');
  });
});

describe('HTTP configuration and persistence', () => {
  it('keeps raw JSON bodies and case-insensitively rejects ambiguous headers', () => {
    expect(parseHttpConfig('{"url":"http://localhost","method":"POST","body":{"id":9007199254740993,"n":1.00}}').body).toBe('{"id":9007199254740993,"n":1.00}');
    expect(() => parseHttpConfig('{"url":"http://localhost","headers":{"x":"a","X":"b"}}')).toThrow('重复');
    expect(() => parseHttpConfig('{"url":"http://localhost","method":"GET","body":"x"}')).toThrow('GET');
    expect(() => parseHttpConfig('{"url":"file:///etc/passwd"}')).toThrow('HTTP');
  });
  it('defaults to excluding credentials/body and validates imported collections', () => {
    const source = '{"method":"POST","url":"https://example.com/?token=abc&q=x","headers":{"Authorization":"Bearer a","Cookie":"session=x","X-Test":"ok"},"body":{"secret":"x"}}';
    const safe = savedHttpConfig(source, false);
    expect(safe).not.toMatch(/Bearer|session=x|abc|secret/); expect(safe).toContain('q=x'); expect(safe).toContain('X-Test');
    expect(savedHttpConfig(source, true)).toBe(source);
    const entry = { id: 'x', name: '请求', config: source, timeout: 500, sensitive: false };
    expect(readHttpCollection(collectionText([entry]))[0].config).toBe(safe);
    expect(() => readHttpCollection(collectionText([entry, entry]))).toThrow('无效');
  });
});
