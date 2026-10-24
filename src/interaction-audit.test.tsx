import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { coordinateInput, extractCoordinates, mergeGeoOutput, parseCoordinate, splitCoordinatePair } from './geography';
import { geoDefaults } from './geo-config';
import { jsonObjectFields, patchJsonField } from './result-model';
import { changeToolOption, createTask, defaultPreferences, editTask, importWorkspace, workspaceSnapshot } from './workbench';
import { defaultOptions, transform } from './tools';
import { resultInputOptions } from './tool-routing';
import ToolWorkspace from './ToolWorkspace';
import ToolResult from './ToolResult';
import GeoWorkbench from './GeoWorkbench';

describe('input and result interaction audit', () => {
  it('keeps extraction text out of empty conversion fields and reports valid per-tab caches as complete', async () => {
    await expect(transform('geo-coordinates', '116°0′0″E,39°0′0″N', geoDefaults)).rejects.toThrow('请输入');
    const options = { ...geoDefaults, lon: '116', lat: '39' };
    const output = mergeGeoOutput('', await transform('geo-coordinates', '', options));
    const task = { ...createTask('geo-coordinates'), options, output, elapsed: 10, status: 'stale' as const };
    const html = renderToStaticMarkup(<GeoWorkbench task={task} onEdit={() => {}} onRun={() => {}} onCancel={() => {}} onNotice={() => {}} />);
    expect(html).toContain('task-status status-success');
    expect(html).not.toContain('参数已修改');
  });
  it('splits DMS, decimal and mixed pairs without converting or normalizing their source text', () => {
    const cases = [
      ['N39°54′27″ E116°23′28.6800″', 'lon-lat', 'E116°23′28.6800″', 'N39°54′27″'],
      ['（东经１１６度２３分２８．６８秒，北纬３９度５４分２７秒）', 'lon-lat', '东经１１６度２３分２８．６８秒', '北纬３９度５４分２７秒'],
      [' +116.39130000 , 39.907500 ', 'lon-lat', '+116.39130000', '39.907500'],
      ['39°54′27″;116.391300', 'lat-lon', '116.391300', '39°54′27″'],
      ['-116:23:28.68\t-39.907500', 'lon-lat', '-116:23:28.68', '-39.907500'],
    ];
    for (const [input, order, lon, lat] of cases) expect(splitCoordinatePair(input, order)).toEqual({ lon, lat });
    for (const input of ['181,39', '116,90.01', 'E116°0′0″,W117°0′0″', '1,2,3']) expect(() => splitCoordinatePair(input)).toThrow();
  });

  it('uses original extracted angles as circle inputs while computed/legacy points retain full precision', async () => {
    const source = '坐标（１２１°２８′２５．２００″E，３１°１３′４９．８″N）';
    const point = extractCoordinates(source, geoDefaults).points[0];
    const fields = coordinateInput(point);
    expect(fields).toEqual({ lon: '１２１°２８′２５．２００″E', lat: '３１°１３′４９．８″N' });
    for (const algorithm of ['sphere', 'ellipsoid']) {
      const result = JSON.parse(await transform('geo-coordinates', '', { ...geoDefaults, mode: 'circle', algorithm, centerLon: fields.lon, centerLat: fields.lat }));
      expect(result.points).toHaveLength(1);
      const calculated = coordinateInput(result.points[0]);
      expect(parseCoordinate(calculated.lon, 'lon')).toBe(result.points[0].lon);
    }
    expect(coordinateInput({ lon: 121.47366666666667, lat: 31.2, rawLon: '0' }).lon).toBe('121.47366666666667');
  });

  it('keeps separate ULID drafts through mode switches and workspace restore', async () => {
    const generated = await transform('ulid', '7', defaultOptions.ulid);
    let task = { ...createTask('ulid'), input: '7', output: generated, status: 'success' as const };
    let next = editTask(task, changeToolOption(task, 'mode', 'parse'));
    expect(next.input).toBe(generated);
    next = editTask(next, { input: '01ARZ3NDEKTSV4RRFFQ69G5FAV\n00000000000000000000000000' });
    const draft = next.input;
    next = editTask(next, changeToolOption(next, 'mode', 'generate'));
    expect(next.input).toBe('7');
    next = importWorkspace(workspaceSnapshot([next], next.id)).tasks[0];
    next = editTask(next, changeToolOption(next, 'mode', 'parse'));
    expect(next.input).toBe(draft);
    expect(changeToolOption(createTask('ulid'), 'mode', 'parse').input).toBe('');
    next = editTask(next, { input: '' });
    next = editTask(next, changeToolOption(next, 'mode', 'generate'));
    next = editTask(next, { status: 'success', output: generated });
    expect(changeToolOption(next, 'mode', 'parse').input).toBe('');
  });

  it('edits only the requested HTTP field and keeps body tokens, spacing and duplicate body keys', async () => {
    const body = '{"id":9007199254740993,"ratio":1.2300e+2,"x":1,"x":2,"note":"中文\\ntext"}';
    const input = `{\n "method":"POST", "url" : "https://example.com", "body": ${body} }\n`;
    const changed = patchJsonField(input, 'url', 'https://example.com/edited');
    expect(changed).toBe(input.replace('https://example.com', 'https://example.com/edited'));
    expect(jsonObjectFields(patchJsonField(changed, 'headers', '{}')).get('body')?.raw).toBe(body);
    for (const style of ['fetch', 'axios', 'curl']) {
      const text = await transform('http-code', changed, { style });
      expect(text).toContain('9007199254740993'); expect(text).not.toContain('9007199254740992');
      expect(text).toContain('1.2300e+2'); expect(text).toContain('application/json');
    }
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    let sent: { body?: string; headers?: Record<string, string>; data?: string } = {};
    await new AsyncFunction('fetch', 'console', await transform('http-code', changed, { style: 'fetch' }))(
      async (_url: string, config: typeof sent) => { sent = config; return { ok: true, text: async () => '' }; }, { log() {} });
    expect(sent.body).toBe(body); expect(sent.headers?.['Content-Type']).toBe('application/json');
    const axios = (await transform('http-code', changed, { style: 'axios' })).replace("import axios from 'axios';", '');
    await new AsyncFunction('axios', 'console', axios)({ request: async (config: typeof sent) => { sent = config; return { data: '' }; } }, { log() {} });
    expect(sent.data).toBe(body);
    expect(() => patchJsonField('{"url":"a","url":"b"}', 'url', 'c')).toThrow('重复');
    const invalid = '{"url":'; expect(() => patchJsonField(invalid, 'url', 'c')).toThrow();
    for (const id of ['query-string', 'env', 'properties'] as const) await expect(transform(id, '{"key":"a","key":"b"}', { mode: 'encode' })).rejects.toThrow('重复');
  });

  it('preserves JWT numeric lexemes in source, payload preview and copy nodes', async () => {
    const encode = (text: string) => btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const payload = '{"id":9007199254740993,"value":1e400,"iat":0}';
    const text = await transform('jwt', `${encode('{"alg":"none"}')}.${encode(payload)}.`);
    expect(text).toContain(payload);
    const markup = renderToStaticMarkup(<ToolResult id="jwt" text={text} source="" options={{}} expected="" onExpected={() => {}} onCopy={() => {}} />);
    expect(markup).toContain('9007199254740993'); expect(markup).toContain('1e400');
    expect(markup).not.toContain('9007199254740992');
  });

  it('routes real results with the compatible language, delimiter and inverse codec mode', async () => {
    const json = '{"value":"你好 + 😄"}';
    for (const id of ['base64', 'url', 'html', 'unicode', 'gzip'] as const) {
      const output = await transform(id, json, defaultOptions[id]);
      const options = resultInputOptions(id, defaultOptions[id], id, 'text');
      expect(await transform(id, output, options)).toBe(json);
    }
    const source = '[{"id":"001","name":"Alice"}]';
    const csv = await transform('json-csv', source, { delimiter: 'tab' });
    expect(JSON.parse(await transform('csv-json', csv, resultInputOptions('json-csv', { delimiter: 'tab' }, 'csv-json', 'text')))).toEqual(JSON.parse(source));
    const java = await transform('json-code', '{"id":1}', { language: 'java', javaStyle: 'record', rootName: 'Item' });
    expect(JSON.parse(await transform('type-json', java, resultInputOptions('json-code', { language: 'java' }, 'type-json', 'java')))).toHaveProperty('id');
    expect(resultInputOptions('json', {}, 'yaml', 'json')).toEqual({ mode: 'json-yaml' });
    const decoded = await transform('base64', btoa('{"name":"Alice"}'), { mode: 'decode' });
    expect(await transform('yaml', decoded, resultInputOptions('base64', { mode: 'decode' }, 'yaml', 'text'))).toContain('name: Alice');
    expect(resultInputOptions('code-format', { language: 'scss' }, 'code-format', 'css')).toEqual({ language: 'scss' });
  });

  it('disables stale/failed/imported copy, export and routing, but allows a successful empty result', () => {
    const base = { ...createTask('base64'), input: 'abc', output: 'YWJj', elapsed: 1 };
    for (const status of ['idle', 'stale', 'error', 'cancelled', 'running', 'success'] as const) {
      const html = renderToStaticMarkup(<ToolWorkspace task={{ ...base, status }} preferences={defaultPreferences} onEdit={() => {}} onRun={() => {}} onCancel={() => {}} onNotice={() => {}} onSend={() => {}} />);
      for (const label of ['复制结果', '导出结果文件']) {
        const tag = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))![0];
        expect(tag.includes('disabled=""'), `${status} ${label}`).toBe(status !== 'success');
      }
    }
    const html = renderToStaticMarkup(<ToolWorkspace task={{ ...base, status: 'success', output: '' }} preferences={defaultPreferences} onEdit={() => {}} onRun={() => {}} onCancel={() => {}} onNotice={() => {}} onSend={() => {}} />);
    expect(html).toContain('处理完成，结果为空');
    expect(html.match(/<button[^>]*aria-label="复制结果"[^>]*>/)![0]).not.toContain('disabled');
  });
});
