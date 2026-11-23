import { randomUUID } from 'node:crypto';
import { prepareMockResponse } from '../shared/mock-response.mjs';
import { fail } from './collab-record.mjs';

const object = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
function recordId(item) {
  if (!object(item)) fail(400, '每条记录必须是 JSON 对象。');
  const id = item.id ?? randomUUID();
  if (!(typeof id === 'string' || Number.isSafeInteger(id)) || !/^[\w~-][\w.~-]{0,99}$/.test(String(id)))
    fail(400, '记录 id 须为整数或 URL 安全的短字符串。');
  return { ...item, id };
}
export function checkDatasetSize(records) {
  if (Buffer.byteLength(JSON.stringify(records)) > 1024 * 1024) fail(413, '数据集最多 1 MiB。');
}
export async function initializeDataset(config) {
  let seed;
  try {
    seed = await prepareMockResponse(config.template, config.count)();
  } catch (error) {
    fail(400, error.message);
  }
  if (!Array.isArray(seed) || seed.length > 100) fail(400, '数据集模板须为最多 100 项的对象数组。');
  const initial = seed.map(recordId);
  if (new Set(initial.map((item) => String(item.id))).size !== initial.length)
    fail(400, '记录 id 重复，请使用 {{index}} 或 {{uuid}}。');
  checkDatasetSize(initial);
  return { initial, records: initial };
}
export function datasetResponse(row, method, id, body) {
  const records = row.records;
  const index = id === undefined ? -1 : records.findIndex((item) => String(item.id) === id);
  if (id !== undefined && index < 0) fail(404, '该记录不存在。');
  if (method === 'GET') return { status: 200, data: id === undefined ? records : records[index] };
  if (!row.dataset.writable) fail(405, '数据集为只读。');
  if (method === 'POST' && id === undefined) {
    if (records.length >= 1000) fail(409, '数据集最多 1,000 条记录。');
    const item = recordId(body);
    if (records.some((existing) => String(existing.id) === String(item.id))) fail(409, '记录 id 已存在。');
    return { status: 201, data: item, records: [...records, item] };
  }
  if (id !== undefined && method === 'DELETE')
    return { status: 204, records: records.filter((_, i) => i !== index) };
  if (id !== undefined && ['PUT', 'PATCH'].includes(method)) {
    if (!object(body) || (Object.hasOwn(body, 'id') && body.id !== records[index].id))
      fail(400, '请提交 JSON 对象，记录 id 不可更改。');
    const item = { ...(method === 'PATCH' ? records[index] : {}), ...body, id: records[index].id };
    return { status: 200, data: item, records: records.map((old, i) => (i === index ? item : old)) };
  }
  fail(405, '列表支持 GET、POST，详情支持 GET、PUT、PATCH、DELETE。');
}
