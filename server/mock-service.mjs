import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkRevision, fail, newRecord, requireRecord, shortText } from './collab-record.mjs';
import { prepareMockResponse } from '../shared/mock-response.mjs';

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const param = /^(?::[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;
function matchesPath(pattern, pathname) {
  const actual = pathname.split('/'),
    expected = pattern.split('/');
  return (
    actual.length === expected.length &&
    expected.every((segment, i) => (param.test(segment) ? !!actual[i] : actual[i] === segment))
  );
}
function definition(input) {
  if (
    !methods.includes(input.method) ||
    typeof input.path !== 'string' ||
    input.path.length > 200 ||
    !input.path.startsWith('/') ||
    (input.path !== '/' &&
      input.path
        .slice(1)
        .split('/')
        .some(
          (segment) =>
            (!/^[a-zA-Z0-9_.~-]+$/.test(segment) && !param.test(segment)) || segment === '.' || segment === '..',
        ))
  )
    fail(400, '请输入以 / 开头的路径，可用 :id 或 {id} 表示路径参数。');
  if (
    !Array.isArray(input.scenarios) ||
    !input.scenarios.length ||
    input.scenarios.length > 12 ||
    !Number.isInteger(input.active) ||
    !input.scenarios[input.active]
  )
    fail(400, '请选择有效场景，最多 12 个。');
  const scenarios = input.scenarios.map((item) => {
    if (
      !item ||
      !Number.isInteger(item.status) ||
      item.status < 200 ||
      item.status > 599 ||
      !Number.isInteger(item.delay) ||
      item.delay < 0 ||
      item.delay > 10000 ||
      !['json', 'text', 'generated'].includes(item.format) ||
      typeof item.body !== 'string' ||
      item.body.length > 64000
    )
      fail(400, '响应状态、延迟或正文无效。');
    if (item.format === 'generated') {
      try { prepareMockResponse(item.template, item.count); }
      catch (error) { fail(400, '场景“' + item.name + '”：' + error.message); }
    }
    if (item.format === 'json' && ![204, 205, 304].includes(item.status)) {
      try {
        JSON.parse(item.body);
      } catch {
        fail(400, '场景“' + item.name + '”的 JSON 格式无效。');
      }
    }
    const queryKey = item.queryKey ?? '',
      queryValue = item.queryValue ?? '';
    if (
      typeof queryKey !== 'string' ||
      typeof queryValue !== 'string' ||
      queryKey.length > 100 ||
      queryValue.length > 500
    )
      fail(400, '场景查询条件过长。');
    return {
      queryKey,
      queryValue,
      name: shortText(item.name, 60, '场景名称'),
      status: item.status,
      delay: item.delay,
      format: item.format,
      ...(item.format === 'generated' && { template: item.template, count: item.count }),
      body: item.body,
    };
  });
  return {
    name: shortText(input.name, 100, '接口名称'),
    method: input.method,
    path: input.path,
    scenarios,
    active: input.active,
    published: input.published === true,
    cors: input.cors === true,
  };
}
export function createMockService(current) {
  const history = new Map();
  const generators = new WeakMap();
  let inflight = 0;
  async function request({ rows, commit, action, input }) {
    if (action === 'list')
      return rows.map(({ scenarios, ...row }) => ({ ...row, scenario: scenarios[row.active].name })).reverse();
    if (action === 'create') {
      if (rows.length >= 150) fail(409, '最多保存 150 个模拟接口。');
      const row = { ...newRecord(), ...definition(input), key: randomBytes(24).toString('hex') };
      await commit([...rows, row]);
      return row;
    }
    const row = requireRecord(rows, input.id);
    if (action === 'read') return { ...row, history: history.get(row.id) || [] };
    checkRevision(row, input.revision);
    if (action === 'remove') {
      await commit(rows.filter((item) => item !== row));
      history.delete(row.id);
      return {};
    }
    let changes;
    if (action === 'save') changes = definition(input);
    else if (action === 'rotate') changes = { key: randomBytes(24).toString('hex') };
    else fail(404, '模拟接口操作不存在。');
    const next = { ...row, ...changes, revision: row.revision + 1 };
    await commit(rows.map((item) => (item === row ? next : item)));
    return next;
  }
  async function serve(req, res, url, enabled) {
    const match = /^\/mock\/([a-f0-9]{48})(\/.*)$/.exec(url.pathname);
    const find = () =>
      enabled() &&
      match &&
      current().find((item) => item.published && item.key === match[1] && matchesPath(item.path, match[2]));
    const route = find();
    if (!route) fail(404, '模拟接口尚未发布或地址已失效。');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (route.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', route.method + ', OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== route.method) {
      res.setHeader('Allow', route.method + ', OPTIONS');
      fail(405, '请求方法与模拟接口不符。');
    }
    if (inflight >= 64) fail(429, '模拟服务繁忙。');
    const scenario =
      route.scenarios.find((s) => s.queryKey && url.searchParams.getAll(s.queryKey).includes(s.queryValue)) ||
      route.scenarios[route.active];
    inflight++;
    try {
      if (scenario.delay) await delay(scenario.delay);
      if (res.destroyed) return;
      let body;
      if (![204, 205, 304].includes(scenario.status)) {
        if (scenario.format === 'generated') {
          if (!generators.has(scenario)) generators.set(scenario, prepareMockResponse(scenario.template, scenario.count));
          body = JSON.stringify(await generators.get(scenario)());
        } else body = scenario.body;
      }
      if (!find()) fail(404, '模拟接口已关闭。');
      const log = {
        at: Date.now(),
        method: req.method,
        scenario: scenario.name,
        status: scenario.status,
        delay: scenario.delay,
      };
      history.set(route.id, [log, ...(history.get(route.id) || [])].slice(0, 30));
      res.writeHead(scenario.status, {
        'Content-Type': (scenario.format === 'text' ? 'text/plain' : 'application/json') + '; charset=utf-8',
      });
      res.end(body);
    } finally {
      inflight--;
    }
  }
  return { request, serve };
}
