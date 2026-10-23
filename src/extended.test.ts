import { describe, expect, it } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { defaultOptions, tools, transform } from './tools';
import type { Options, ToolId } from './tools';
import { extendedTools } from './extended';
import { developerPresentation } from './tool-presentation';
import { createTask, importWorkspace, workspaceSnapshot } from './workbench';
import { detectTools } from './detection';

const run = (id: ToolId, input: string, options: Options = {}) => transform(id, input, { ...defaultOptions[id], ...options });
describe('research-driven offline additions', () => {
  it('runs every added example with its actual defaults and survives workspace restoration', async () => {
    for (const tool of extendedTools) {
      expect(await run(tool.id, tool.sample)).toBeTruthy();
      const task = createTask(tool.id, '4', tool.sample);
      expect(importWorkspace(workspaceSnapshot([task], task.id)).tasks[0].toolId).toBe(tool.id);
    }
    expect(createTask('xml', '4').options.indent).toBe('4');
  });
  it('formats XML with attributes, namespaces, comments and CDATA without interpreting markup', async () => {
    const source = '<?xml version="1.0"?><r xmlns:x="urn:test"><!-- keep --><x:p a="&quot;"><![CDATA[<script>1</script>]]></x:p><n>你好</n></r>';
    const formatted = await run('xml', source);
    expect(formatted).toContain('\n  <!-- keep -->');
    expect(formatted).toContain('<![CDATA[<script>1</script>]]>');
    expect(formatted).toContain('xmlns:x="urn:test"');
    expect(await run('xml', '<r>\n <a>1</a>\n <b/>\n</r>', { mode: 'compact' })).toBe('<r><a>1</a><b/></r>');
  });
  it('preserves common mixed text and explicitly preserved whitespace', async () => {
    const mixed = '<p>Hello <b>world</b> !</p>';
    expect(await run('xml', mixed)).toBe(mixed);
    const preserved = '<p xml:space="preserve"> a  \n <b> b </b> c </p>';
    expect(await run('xml', preserved, { mode: 'compact' })).toBe(preserved);
  });
  it('rejects malformed XML, DTD/entity declarations and oversized input', async () => {
    for (const value of ['<a><b></a>', '<!DOCTYPE r SYSTEM "file:///etc/passwd"><r/>', '<!ENTITY x "secret"><r/>', 'not xml', '<r>' + 'x'.repeat(200_000) + '</r>']) await expect(run('xml', value)).rejects.toThrow();
  });
  it('roundtrips UTF-8 GZip against the independent Node zlib implementation', async () => {
    const text = '你好 😄\u0000\r\n'.repeat(1000);
    const encoded = await run('gzip', text);
    expect(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8')).toBe(text);
    expect(await run('gzip', gzipSync(text).toString('base64'), { mode: 'decompress' })).toBe(text);
    expect(await run('gzip', await run('gzip', ''), { mode: 'decompress' })).toBe('');
  });
  it('rejects corrupt gzip, invalid base64, truncated streams and binary results', async () => {
    for (const value of ['not base64!', 'YWJj', 'H4sIAAA=', gzipSync('hello').subarray(0, -3).toString('base64'), gzipSync(Buffer.from([255, 254])).toString('base64')]) await expect(run('gzip', value, { mode: 'decompress' })).rejects.toThrow();
  });
  it('stops decompression before returning an oversized expansion', async () => {
    const compressed = gzipSync('x'.repeat(4_000_001)).toString('base64');
    await expect(run('gzip', compressed, { mode: 'decompress' })).rejects.toThrow(/4,000,000/);
  });
  it('calculates subnet metadata with either CIDR or dotted masks', async () => {
    const expected = { cidr: '192.168.10.0/24', network: '192.168.10.0', broadcast: '192.168.10.255', firstHost: '192.168.10.1', lastHost: '192.168.10.254', usableHosts: 254, netmask: '255.255.255.0' };
    expect(JSON.parse(await run('ipv4', '192.168.10.42/24'))).toMatchObject(expected);
    expect(JSON.parse(await run('ipv4', '192.168.10.42/255.255.255.0'))).toMatchObject(expected);
  });
  it('handles unsigned high addresses and the /0, /31 and /32 boundaries', async () => {
    expect(JSON.parse(await run('ipv4', '255.255.255.255/0'))).toMatchObject({ network: '0.0.0.0', broadcast: '255.255.255.255', totalAddresses: 4294967296 });
    expect(JSON.parse(await run('ipv4', '192.0.2.3/31'))).toMatchObject({ firstHost: '192.0.2.2', lastHost: '192.0.2.3', usableHosts: 2, broadcast: null });
    expect(JSON.parse(await run('ipv4', '255.255.255.255/32'))).toMatchObject({ firstHost: '255.255.255.255', lastHost: '255.255.255.255', usableHosts: 1, broadcast: null });
  });
  it('rejects ambiguous or discontinuous network input', async () => {
    for (const value of ['192.168.01.1/24', '256.1.1.1/24', '1.2.3/24', '1.2.3.4/33', '1.2.3.4/-1', '1.2.3.4/255.0.255.0', '1.2.3.4/24/1']) await expect(run('ipv4', value)).rejects.toThrow();
  });
  it('roundtrips every standard Unix permission and special-bit combination', async () => {
    for (let mode = 0; mode <= 0o7777; mode++) {
      const octal = mode.toString(8).padStart(4, '0');
      const result = JSON.parse(await run('chmod', octal));
      expect(JSON.parse(await run('chmod', result.symbolic)).octal).toBe(octal);
    }
    expect(JSON.parse(await run('chmod', '-rwsr-Sr-t'))).toMatchObject({ octal: '7745', special: { setuid: true, setgid: true, sticky: true } });
    expect(JSON.parse(await run('chmod', 'drwxr-xr-x')).octal).toBe('0755');
  });
  it('rejects chmod expressions and commands instead of executing anything', async () => {
    for (const value of ['888', '77777', 'u+x', 'chmod 777 file', 'rwxrwxrwq', '---t-----']) await expect(run('chmod', value)).rejects.toThrow();
  });
  it('generates sortable unique ULIDs with a fixed 48-bit timestamp and exact 80-bit random field', async () => {
    const ids = (await run('ulid', '1000', { timestamp: '0' })).split('\n');
    expect(new Set(ids).size).toBe(1000);
    expect(ids).toEqual([...ids].sort());
    expect(ids.every(id => /^0000000000[0-9A-HJKMNP-TV-Z]{16}$/.test(id))).toBe(true);
    expect(JSON.parse(await run('ulid', ids[0].toLowerCase(), { mode: 'parse' }))[0]).toMatchObject({ timestamp: 0, utc: '1970-01-01T00:00:00.000Z' });
    expect(JSON.parse(await run('ulid', '7ZZZZZZZZZZZZZZZZZZZZZZZZZ', { mode: 'parse' }))[0].timestamp).toBe(281474976710655);
  });
  it('rejects ULID overflow, forbidden Crockford characters and invalid counts', async () => {
    for (const value of ['8ZZZZZZZZZZZZZZZZZZZZZZZZZ', '0000000000000000000000000I', '0000000000000000000000000U', 'abc']) await expect(run('ulid', value, { mode: 'parse' })).rejects.toThrow();
    for (const count of ['0', '1001', '1.5', '-1', '1e2']) await expect(run('ulid', count)).rejects.toThrow();
    await expect(run('ulid', '1', { timestamp: '281474976710656' })).rejects.toThrow();
  });
  it('distinguishes bytes, UTF-16 units, code points and grapheme clusters', async () => {
    expect(JSON.parse(await run('text-stats', 'A中😄e\u0301'))).toMatchObject({ utf8Bytes: 11, utf16Units: 6, unicodeCodePoints: 5, graphemeClusters: 4, lines: 1 });
    expect(JSON.parse(await run('text-stats', '👨‍👩‍👧‍👦'))).toMatchObject({ utf16Units: 11, unicodeCodePoints: 7, graphemeClusters: 1 });
    expect(JSON.parse(await run('text-stats', 'a\r\nb\nc\r'))).toMatchObject({ lines: 4, nonEmptyLines: 3, lineEndings: { crlf: 1, lf: 1, cr: 1 } });
    expect(JSON.parse(await run('text-stats', ''))).toMatchObject({ lines: 0, words: 0, utf8Bytes: 0 });
  });
  it('uses mode-specific examples that really execute', async () => {
    expect(await run('gzip', developerPresentation('gzip', { mode: 'decompress' })!.sample!, { mode: 'decompress' })).toBe('Hello');
    expect(JSON.parse(await run('ulid', developerPresentation('ulid', { mode: 'parse' })!.sample!, { mode: 'parse' }))).toHaveLength(1);
  });
});

describe('explicit content recommendations', () => {
  it('recommends a useful JSON pipeline with the correct conversion direction', () => {
    const suggestions = detectTools('[{"id":9007199254740993}]');
    expect(suggestions.map(item => item.id)).toEqual(['json', 'json-code', 'json-csv', 'yaml']);
    expect(suggestions.find(item => item.id === 'yaml')!.options).toEqual({ mode: 'json-yaml' });
  });
  it('recognizes encodings, timestamps and source types with appropriate options', () => {
    expect(detectTools('H4sIAAAAAAACA/NIzcnJBwCCidH3BQAAAA==')[0]).toMatchObject({ id: 'gzip', options: { mode: 'decompress' } });
    expect(detectTools('00000000000000000000000000')[0]).toMatchObject({ id: 'ulid', options: { mode: 'parse' } });
    expect(detectTools('1735689600000')[0]).toMatchObject({ id: 'timestamp', options: { unit: 'ms' } });
    expect(detectTools('interface User { id: number }')[0]).toMatchObject({ id: 'type-json', options: { language: 'ts' } });
    expect(detectTools('public record User(Long id) {}')[0]).toMatchObject({ id: 'type-json', options: { language: 'java' } });
  });
  it('handles URLs, JWT, XML, subnet and Unix permissions without executing or fetching content', () => {
    for (const [source, id] of [['https://example.com/?x=1&x=2', 'url-inspect'], ['eyJhbGciOiJub25lIn0.eyJhIjoxfQ.', 'jwt'], ['<r/>', 'xml'], ['192.168.1.1/24', 'ipv4'], ['rwxr-xr-x', 'chmod']]) expect(detectTools(source)[0].id).toBe(id);
    for (const suggestion of detectTools('{"id":1}')) expect(tools.some(tool => tool.id === suggestion.id)).toBe(true);
  });
  it('keeps ambiguous formats as suggestions, falls back to statistics and bounds main-thread work', () => {
    expect(detectTools('hello world')[0].id).toBe('text-stats');
    expect(detectTools('{broken json')[0].id).toBe('text-stats');
    expect(detectTools('')).toEqual([]);
    expect(() => detectTools('x'.repeat(200_001))).toThrow(/200,000/);
  });
});
