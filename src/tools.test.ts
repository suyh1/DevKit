import { describe, expect, it } from 'vitest';
import { transform } from './tools';

describe('offline tools', () => {
  it('formats, compacts and rejects malformed JSON', async () => {
    expect(await transform('json', '{"中文":true}')).toBe('{\n  "中文": true\n}');
    expect(await transform('json', ' { "a": [1, 2] } ', { mode: 'compact' })).toBe('{"a":[1,2]}');
    await expect(transform('json', '{oops}')).rejects.toThrow();
  });
  it('preserves large JSON numbers, duplicate keys and string whitespace', async () => {
    const input = '{"id":9007199254740993,"id":1e400,"text":"a  b \\"x\\""}';
    const output = await transform('json', input);
    expect(output).toContain('9007199254740993');
    expect(output).toContain('1e400');
    expect(await transform('json', output, { mode: 'compact' })).toBe(input);
    expect(await transform('json', '{"a":[],"b":{}}')).toBe('{\n  "a": [],\n  "b": {}\n}');
  });
  it('round-trips UTF-8 including astral symbols and rejects invalid bytes', async () => {
    const text = '中文 / 😄 / café';
    const encoded = await transform('base64', text);
    expect(await transform('base64', encoded, { mode: 'decode' })).toBe(text);
    await expect(transform('base64', '/w==', { mode: 'decode' })).rejects.toThrow();
    await expect(transform('base64', '%%%!', { mode: 'decode' })).rejects.toThrow();
  });
  it('round-trips URL parameter data and rejects malformed escapes', async () => {
    const input = 'a=中文 &x=+/#';
    expect(await transform('url', await transform('url', input), { mode: 'decode' })).toBe(input);
    await expect(transform('url', '%zz', { mode: 'decode' })).rejects.toThrow();
  });
  it('handles epoch, negative values, units and explicit timezone dates', async () => {
    expect(await transform('timestamp', '0')).toContain('1970-01-01T00:00:00.000Z');
    expect(await transform('timestamp', '-1')).toContain('1969-12-31T23:59:59.000Z');
    expect(await transform('timestamp', '1735689600000', { unit: 'ms' })).toContain('2025-01-01T00:00:00.000Z');
    expect(await transform('timestamp', '2025-01-01T08:00:00+08:00')).toContain('2025-01-01T00:00:00.000Z');
    await expect(transform('timestamp', '2025-01-01')).rejects.toThrow();
    await expect(transform('timestamp', '2025-02-29T00:00:00Z')).rejects.toThrow();
    await expect(transform('timestamp', '2025-01-01T24:00:00Z')).rejects.toThrow();
    await expect(transform('timestamp', '999999999999999999999')).rejects.toThrow();
  });
  it('matches published SHA test vectors', async () => {
    expect(await transform('hash', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await transform('hash', '', { algorithm: 'SHA-1' })).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });
  it('generates requested UUID v4 count with valid variant and unique values', async () => {
    const ids = (await transform('uuid', '100')).split('\n');
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    ids.forEach(id => expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
    for (const input of ['0', '1001', '1.5', '']) await expect(transform('uuid', input)).rejects.toThrow();
  });
  it('reports groups and positions, single matches and empty unicode matches', async () => {
    const result = JSON.parse(await transform('regex', 'ab ab', { pattern: '(?<letter>a)(b)', flags: 'g' }));
    expect(result.count).toBe(2);
    expect(result.matches[1]).toEqual({ match: 'ab', index: 3, groups: ['a', 'b'], namedGroups: { letter: 'a' } });
    expect(JSON.parse(await transform('regex', 'aaa', { pattern: 'a', flags: '' })).count).toBe(1);
    expect(JSON.parse(await transform('regex', '😄', { pattern: '(?:)', flags: 'gu' })).count).toBe(2);
    expect(JSON.parse(await transform('regex', 'abc', { pattern: 'z', flags: 'g' })).count).toBe(0);
    await expect(transform('regex', 'a', { pattern: '[', flags: 'g' })).rejects.toThrow();
  });
  it('bounds input size', async () => {
    await expect(transform('json', 'x'.repeat(2_000_001))).rejects.toThrow('2 MB');
  });
});
