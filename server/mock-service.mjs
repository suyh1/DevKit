import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { checkRevision, fail, newRecord, requireRecord, shortText } from './collab-record.mjs';
import { prepareMockResponse } from '../shared/mock-response.mjs';

import { generateSchemaResponse } from '../shared/mock-schema.mjs';
import { chooseScenario, validField } from '../shared/mock-request.mjs';
import { checkDatasetSize, datasetResponse, initializeDataset } from './mock-dataset.mjs';
import { journalInput, readMockInput } from './mock-call.mjs';

export const mutateDataset = Symbol('public dataset mutation');
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const param = /^(?::[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;
function matchPath(pattern, pathname) {
  const actual = pathname.split('/'),
    expected = pattern.split('/');
  if (actual.length !== expected.length) return;
  const path = Object.create(null);
  for (const [i, segment] of expected.entries()) {
    if (param.test(segment) && actual[i]) {
      try {
        path[segment.replace(/^[:{]|}$/g, '')] = decodeURIComponent(actual[i]);
      } catch {
        return;
      }
    } else if (actual[i] !== segment) return;
  }
  return path;
}
function publicRow({ initial, records, ...row }) {
  return records ? { ...row, size: records.length } : row;
}
function routePatterns(row) {
  return row.dataset ? [row.path, row.path + '/:id'] : [row.path];
}
function overlaps(a, b) {
  const left = a.split('/'),
    right = b.split('/');
  return (
    left.length === right.length &&
    left.every((part, i) => part === right[i] || param.test(part) || param.test(right[i]))
  );
}
async function definition(input, rows, old) {
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
            (!/^[a-zA-Z0-9_.~-]+$/.test(segment) && !param.test(segment)) ||
            segment === '.' ||
            segment === '..',
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
  const scenarios = await Promise.all(
    input.scenarios.map(async (item) => {
      if (
        !item ||
        !Number.isInteger(item.status) ||
        item.status < 200 ||
        item.status > 599 ||
        !Number.isInteger(item.delay) ||
        item.delay < 0 ||
        item.delay > 10000 ||
        !['json', 'text', 'generated', 'schema'].includes(item.format) ||
        typeof item.body !== 'string' ||
        item.body.length > 64000
      )
        fail(400, '响应状态、延迟或正文无效。');
      if (item.schema !== undefined && (typeof item.schema !== 'string' || item.schema.length > 64000))
        fail(400, '响应 Schema 过长。');
      if (item.format === 'schema') {
        try {
          await generateSchemaResponse(item.schema);
        } catch (error) {
          fail(400, '场景“' + item.name + '”：' + error.message);
        }
      }
      if (item.format === 'generated') {
        try {
          prepareMockResponse(item.template, item.count);
        } catch (error) {
          fail(400, '场景“' + item.name + '”：' + error.message);
        }
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
      if (
        item.rules !== undefined &&
        (!Array.isArray(item.rules) ||
          item.rules.length > 8 ||
          item.rules.some(
            (r) => !r || !validField(r.source, r.key) || typeof r.value !== 'string' || r.value.length > 500,
          ))
      )
        fail(400, '匹配条件无效，每个场景最多 8 项。');
      return {
        ...(item.rules && { rules: item.rules.map(({ source, key, value }) => ({ source, key, value })) }),
        ...(item.schema && { schema: item.schema }),
        queryKey,
        queryValue,
        name: shortText(item.name, 60, '场景名称'),
        status: item.status,
        delay: item.delay,
        format: item.format,
        ...(item.format === 'generated' && { template: item.template, count: item.count }),
        body: item.body,
      };
    }),
  );
  const project = input.project ? shortText(input.project, 60, '项目名称') : '';
  const peer = project && rows.find((row) => row.project === project);
  const projectKey = project ? peer?.projectKey || randomBytes(24).toString('hex') : '';
  if (
    project &&
    rows.some(
      (row) =>
        row.id !== old?.id &&
        row.project === project &&
        (row.dataset || input.dataset || row.method === input.method) &&
        routePatterns(row).some((a) => routePatterns(input).some((b) => overlaps(a, b))),
    )
  )
    fail(409, '项目中已有相同方法或重叠路径。');
  const fields = input.fields ?? [];
  if (
    !Array.isArray(fields) ||
    fields.length > 80 ||
    fields.some((field) => !field || !validField(field.source, field.key))
  )
    fail(400, '请求字段列表无效。');
  let dataset;
  if (input.dataset) {
    if (
      !project ||
      input.path === '/' ||
      input.path.split('/').some((s) => param.test(s)) ||
      input.method !== 'GET'
    )
      fail(400, '数据集需要项目名称、GET 方法和固定的集合路径。');
    const { template, count, writable } = input.dataset;
    if (old?.dataset && (template !== old.dataset.template || count !== old.dataset.count))
      fail(409, '已有数据集的初始模板不可修改。');
    dataset = {
      dataset: { template, count, writable: writable === true },
      ...(old?.dataset
        ? { initial: old.initial, records: old.records }
        : await initializeDataset(input.dataset)),
    };
  } else if (old?.dataset) fail(409, '已有数据集不能改为普通接口。');
  return {
    project,
    projectKey,
    fields: fields.map(({ source, key }) => ({ source, key })),
    ...dataset,
    name: shortText(input.name, 100, '接口名称'),
    method: input.method,
    path: input.path,
    scenarios,
    active: input.active,
    published: input.published === true,
    cors: input.cors === true,
  };
}
export function createMockService(current, mutate) {
  const history = new Map();
  const generators = new WeakMap();
  let inflight = 0;
  async function request({ rows, commit, action, input }) {
    if (action === 'list')
      return rows
        .map(({ scenarios, ...row }) => ({ ...publicRow(row), scenario: scenarios[row.active].name }))
        .reverse();
    if (action === 'create') {
      if (rows.length >= 150) fail(409, '最多保存 150 个模拟接口。');
      const row = {
        ...newRecord(),
        ...(await definition(input, rows)),
        key: randomBytes(24).toString('hex'),
      };
      await commit([...rows, row]);
      return publicRow(row);
    }
    const row = requireRecord(rows, input.id);
    if (action === mutateDataset) {
      const result = datasetResponse(row, input.method, input.recordId, input.body);
      if (result.records) {
        checkDatasetSize(result.records);
        await commit(rows.map((item) => (item === row ? { ...row, records: result.records } : item)));
      }
      return { status: result.status, data: result.data };
    }
    if (action === 'read') return { ...publicRow(row), history: history.get(row.id) || [] };
    checkRevision(row, input.revision);
    if (action === 'remove') {
      await commit(rows.filter((item) => item !== row));
      history.delete(row.id);
      return {};
    }
    let changes;
    if (action === 'save') changes = await definition(input, rows, row);
    else if (action === 'reset' && row.dataset) changes = { records: row.initial };
    else if (action === 'rotate') changes = { key: randomBytes(24).toString('hex') };
    else fail(404, '模拟接口操作不存在。');
    const next = { ...row, ...changes, revision: row.revision + 1 };
    await commit(rows.map((item) => (item === row ? next : item)));
    return publicRow(next);
  }
  async function serve(req, res, url, enabled) {
    const match = /^\/mock\/([a-f0-9]{48})(\/.*)$/.exec(url.pathname);
    const start = performance.now();
    if (!match || !enabled()) fail(404, '模拟接口尚未发布或地址已失效。');
    const [, key, pathname] = match;
    const available = current().filter((row) => row.published && (row.key === key || row.projectKey === key));
    const candidates = available.flatMap((row) =>
      routePatterns(row)
        .map((pattern) => ({ row, params: matchPath(pattern, pathname) }))
        .filter((hit) => hit.params),
    );
    const requestedMethod =
      req.method === 'OPTIONS' ? req.headers['access-control-request-method'] : req.method;
    const hit = candidates.find(({ row }) => row.dataset || row.method === requestedMethod) || candidates[0];
    const route = hit?.row || available.find((row) => row.key === key);
    if (!route) fail(404, '没有匹配的接口。');
    const authorize = () => {
      const latest = current().find((row) => row.id === route.id);
      if (!enabled() || !latest?.published || latest.revision !== route.revision)
        fail(404, '模拟接口配置已变化。');
    };
    const record = (status, scenario, delay, reason, input = {}) => {
      if (!current().some((row) => row.id === route.id)) return;
      const log = {
        at: Date.now(),
        method: req.method,
        status,
        scenario,
        delay,
        reason,
        elapsed: Math.round(performance.now() - start),
        ...journalInput(req, pathname, url, input),
      };
      history.set(route.id, [log, ...(history.get(route.id) || [])].slice(0, 30));
    };
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (route.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Methods',
        (route.dataset ? (route.dataset.writable ? methods.join(', ') : 'GET') : route.method) + ', OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] || 'Content-Type, Authorization',
      );
    }
    if (!hit) {
      record(404, '未匹配', 0, '请求路径与配置不同');
      fail(404, '请求路径与配置不同。');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!route.dataset && req.method !== route.method) {
      record(405, '未匹配', 0, '预期方法 ' + route.method);
      res.setHeader(
        'Allow',
        (route.dataset ? (route.dataset.writable ? methods.join(', ') : 'GET') : route.method) + ', OPTIONS',
      );
      fail(405, '请求方法与模拟接口不符。');
    }
    if (inflight >= 64) fail(429, '模拟服务繁忙。');
    inflight++;
    let input = {},
      scenario;
    try {
      input = await readMockInput(req);
      authorize();
      if (route.dataset) {
        const id = hit.params.id;
        const result =
          req.method === 'GET'
            ? datasetResponse(
                current().find((row) => row.id === route.id),
                req.method,
                id,
              )
            : await mutate({ id: route.id, method: req.method, recordId: id, body: input.body }, authorize);
        authorize();
        record(result.status, '项目数据集', 0, id === undefined ? '集合路径' : '记录 ID 匹配', input);
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(result.data));
      }
      const query = Object.create(null);
      for (const [key, value] of url.searchParams) (query[key] ??= []).push(value);
      const context = { path: hit.params, query, header: req.headers, body: input.body };
      const selected = chooseScenario(route, context);
      scenario = selected.scenario;
      if (scenario.delay) await delay(scenario.delay);
      if (res.destroyed) return;
      authorize();
      let body;
      if (![204, 205, 304].includes(scenario.status)) {
        if (scenario.format === 'generated') {
          if (!generators.has(scenario))
            generators.set(scenario, prepareMockResponse(scenario.template, scenario.count));
          body = JSON.stringify(await generators.get(scenario)(context));
        } else if (scenario.format === 'schema')
          body = JSON.stringify(await generateSchemaResponse(scenario.schema, context));
        else body = scenario.body;
      }
      authorize();
      record(scenario.status, scenario.name, scenario.delay, selected.reason, input);
      res.writeHead(scenario.status, {
        'Content-Type': (scenario.format === 'text' ? 'text/plain' : 'application/json') + '; charset=utf-8',
      });
      res.end(body);
    } catch (error) {
      record(error.status || 400, scenario?.name || '请求失败', scenario?.delay || 0, error.message, input);
      throw error;
    } finally {
      inflight--;
    }
  }
  return { request, serve };
}
