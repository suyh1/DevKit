import { randomUUID } from 'node:crypto';

export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export function shortText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, label + '无效或过长。');
  return value.trim();
}
export function requireRecord(rows, id) {
  return rows.find((row) => row.id === id) || fail(404, '项目已删除或过期。');
}
export function checkRevision(row, revision) {
  if (row.revision !== revision) fail(409, '其他设备已更新此项，请重新载入后再保存。');
}
export const newRecord = () => ({ id: randomUUID(), revision: 1, created: Date.now() });
