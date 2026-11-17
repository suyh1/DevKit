import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { appendFile, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { emptySharingServices, sharingServices } from '../shared/sharing.mjs';

const fail = message => { throw new Error(message); };
export function passwordRecord(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail('访问口令需为 8–128 字符。');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}
export function matchesPassword(password, record) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const salt = record?.salt || '50f37b4a5efdf908a02b730b73595b5d';
  const hash = /^[a-f0-9]{64}$/.test(record?.hash || '') ? record.hash : '0'.repeat(64);
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(hash, 'hex')) && !!record;
}
export function updateVisitors(input, previous = []) {
  if (input === undefined) return previous;
  if (!Array.isArray(input) || input.length > 30) fail('最多配置 30 名访客。');
  const names = new Set();
  return input.map(item => {
    const name = typeof item?.name === 'string' && item.name.normalize('NFC').trim();
    if (!name || !/^[\p{L}\p{N}_.-]{1,48}$/u.test(name) || names.has(name)) fail('访客名称必须唯一，仅可用字母、数字、下划线、点和短横线。');
    names.add(name);
    const existing = previous.find(record => record.name === name);
    const credentials = item.password ? passwordRecord(item.password) : existing;
    if (!credentials) fail(`请设置访客 ${name} 的访问口令。`);
    return { name, salt: credentials.salt, hash: credentials.hash, services: sharingServices({ services: item.services }) };
  });
}
export function visitorServices(global, visitor) {
  const result = emptySharingServices();
  for (const [module, permissions] of Object.entries(result)) {
    for (const key of Object.keys(permissions)) permissions[key] = global[module][key] && visitor[module][key];
  }
  return result;
}
export function createSharingAudit(directory) {
  const file = path.join(directory, 'sharing-audit.jsonl');
  let writes = Promise.resolve();
  return {
    flush: () => writes,
    record(visitor, action, outcome) {
      const entry = JSON.stringify({ at: new Date().toISOString(), visitor, action, outcome }) + '\n';
      writes = writes.then(async () => {
        const info = await stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (info?.size >= 256 * 1024) await rename(file, file + '.previous');
        await appendFile(file, entry, { mode: 0o600 });
      }).catch(() => {});
    },
    async recent() {
      await writes;
      const contents = await Promise.all([file + '.previous', file].map(filename => readFile(filename, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; })));
      return contents.join('').trim().split('\n').filter(Boolean).slice(-100).reverse().map(line => JSON.parse(line));
    },
  };
}
