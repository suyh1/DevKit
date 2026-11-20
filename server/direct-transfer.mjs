import { randomUUID } from 'node:crypto';
import { fail } from './collab-record.mjs';

// Only file descriptions and WebRTC negotiation messages live here. File data stays on the peers.
export function createDirectDirectory(changed) {
  const listings = new Map(),
    requests = new Map();
  function remove(id) {
    if (!listings.delete(id)) return;
    for (const [key, req] of requests) if (req.id === id) requests.delete(key);
    changed();
  }
  function sweep(now) {
    for (const [id, item] of listings) if (item.until <= now || item.row.expires <= now) remove(id);
    for (const [key, req] of requests) if (req.until <= now) requests.delete(key);
  }
  function signal(value) {
    if (
      typeof value !== 'string' ||
      value.length > 32768 ||
      !value.startsWith('v=0') ||
      !/^m=application /m.test(value)
    )
      fail(400, '直连协商信息无效。');
    return value;
  }
  return {
    sweep,
    remove,
    ownedBy: (id, owner) => listings.get(id)?.owner === owner,
    release(owner, scope = false) {
      const matches = value => scope ? typeof value === 'string' && value.startsWith(owner) : value === owner;
      for (const [id, listing] of listings) if (matches(listing.owner)) remove(id);
      for (const [key, req] of requests) if (matches(req.owner)) requests.delete(key);
    },
    rows: () => Array.from(listings.values(), (item) => item.row),
    get: (id) => listings.get(id)?.row,
    publish(row, owner) {
      listings.set(row.id, { row, owner, until: Date.now() + 90_000 });
      changed();
      return { id: row.id };
    },
    claim(input, owner) {
      if (!listings.has(input.id)) fail(410, '发送方已离线或已结束直传。');
      if (requests.size >= 256) fail(429, '直连请求较多，请稍后重试。');
      const key = randomUUID();
      requests.set(key, { id: input.id, owner, offer: signal(input.offer), until: Date.now() + 60_000 });
      return { key };
    },
    presence(input, owner) {
      if (!Array.isArray(input.ids) || input.ids.length > 250) fail(400, '直传文件列表无效。');
      const ids = new Set(input.ids.filter((id) => listings.has(id) && listings.get(id).owner === owner));
      for (const id of ids) listings.get(id).until = Date.now() + 90_000;
      const offers = [];
      for (const [key, req] of requests)
        if (ids.has(req.id) && !req.answer) offers.push({ key, id: req.id, offer: req.offer });
      return { ids: [...ids], offers };
    },
    reply(input, owner) {
      const req = requests.get(input.key);
      if (!req || listings.get(req.id)?.owner !== owner) fail(404, '直连请求已失效。');
      req.answer = signal(input.answer);
    },
    answer(input, owner) {
      const req = requests.get(input.key);
      if (!req || req.owner !== owner) fail(404, '直连请求已失效。');
      return { answer: req.answer };
    },
  };
}
