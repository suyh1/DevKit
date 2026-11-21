import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { open, readdir, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { newRecord, requireRecord, shortText, fail } from './collab-record.mjs';
import { createDirectDirectory } from './direct-transfer.mjs';

const partSize = 1024 * 1024;
export const openTransferFile = Symbol('open transfer file');
const derive = promisify(scrypt);
const sessionDigest = session => session && createHash('sha256').update(session).digest('hex');

// Each item has its own key. Only the publishing client receives it; the index holds the ciphertext.
function sealPickup(password, key, id, session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(password), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex'), session: sessionDigest(session) };
}

function publisherPassword(item, key, session) {
  const sealed = item.protection?.publisher;
  if (!sealed || sealed.session !== sessionDigest(session) || typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
    fail(403, '请在发布此项的设备和入口查看取件密码。');
  try {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(sealed.iv, 'hex'));
    decipher.setAAD(Buffer.from(item.id));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'hex')), decipher.final()]).toString('utf8'));
  } catch {
    fail(403, '发布凭据无效。');
  }
}

async function protection(password) {
  if (password === '' || password === undefined) return undefined;
  if (typeof password !== 'string' || !password.trim() || password.length > 128)
    fail(400, '取件密码需为 1 至 128 个字符。');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await derive(password, salt, 32)).toString('hex') };
}
const lifetimes = [1, 24, 168];
export async function createTransferService(folder, initial, changed) {
  const direct = createDirectDirectory(changed);
  const completed = new Map();
  const pending = new Map(),
    tickets = new Map(),
    attempts = new Map();
  const filename = (id) => path.join(folder, 'transfer-' + id + '.bin');
  const discard = (id) =>
    unlink(filename(id)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  for (const item of initial) {
    if (
      !Number.isSafeInteger(item.expires) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      !['file', 'text', 'link'].includes(item.kind) ||
      (item.kind === 'file' ? typeof item.name !== 'string' : typeof item.text !== 'string') ||
      (item.protection !== undefined &&
        (!/^[a-f0-9]{32}$/.test(item.protection?.salt) || !/^[a-f0-9]{64}$/.test(item.protection?.hash)))
    ) {
      fail(500, '快传索引无效，请检查主机备份。');
    }
  }
  const known = new Set(initial.filter((item) => item.kind === 'file').map((item) => path.basename(filename(item.id))));
  for (const name of await readdir(folder)) {
    if (/^transfer-[a-f0-9-]{36}\.bin$/.test(name) && !known.has(name)) await unlink(path.join(folder, name));
  }
  async function request({ rows, commit, action, input, access }) {
    const now = Date.now();
    direct.sweep(now);
    const live = rows.filter((item) => item.expires > now);
    if (live.length !== rows.length) {
      await commit(live);
      for (const item of rows) if (item.expires <= now && item.kind === 'file') await discard(item.id);
    }
    for (const [id, upload] of pending)
      if (now - upload.touched > 10 * 60_000) {
        await discard(id);
        pending.delete(id);
      }
    for (const [key, value] of completed) if (value.until <= now) completed.delete(key);
    for (const [key, value] of tickets) if (value.until <= now) tickets.delete(key);
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (action === 'list')
      return [...live, ...direct.rows()].sort((a, b) => b.created - a.created)
        .map(({ protection, text, ...item }) => ({
          ...item,
          locked: !!protection,
          text: protection ? undefined : text,
        }));
    if (action === 'recall') {
      const item = direct.get(input.id) || requireRecord(live, input.id);
      access.authorize?.();
      return { password: publisherPassword(item, input.key, access.publisherSession) };
    }
    if (action === 'unlock') {
      const item = direct.get(input.id) || requireRecord(live, input.id);
      if (!item.protection) fail(400, '此项无需取件密码。');
      const key = item.id + ':' + (access.attemptKey || access.owner || '');
      const attempt = attempts.get(key) || { count: 0, until: now + 60000 };
      if (attempt.count >= 5 || (attempts.size >= 4096 && !attempts.has(key))) fail(429, '尝试次数过多，请稍后再试。');
      if (typeof input.password !== 'string' || !input.password.length || input.password.length > 128)
        fail(400, '请输入取件密码。');
      attempt.count++;
      attempts.set(key, attempt);
      const hash = await derive(input.password, item.protection.salt, 32);
      if (!timingSafeEqual(hash, Buffer.from(item.protection.hash, 'hex'))) fail(403, '取件密码不正确。');
      access.authorize?.();
      attempts.delete(key);
      if (item.kind !== 'file') return { text: item.text };
      if (tickets.size >= 2048) tickets.delete(tickets.keys().next().value);
      const ticket = randomBytes(24).toString('hex');
      tickets.set(ticket, { id: item.id, owner: access.owner, until: now + 600000 });
      return { ticket };
    }
    if (action === 'sweep') return;
    if (action === 'presence') return direct.presence(input, access.owner);
    if (action === 'reply') return direct.reply(input, access.owner);
    if (action === 'answer') return direct.answer(input, access.owner);
    if (action === 'claim') {
      const ticket = tickets.get(input.ticket);
      if (!ticket || ticket.id !== input.id || ticket.owner !== access.owner) fail(403, '请先输入取件密码。');
      const claimed = direct.claim(input, access.owner);
      tickets.delete(input.ticket);
      return claimed;
    }
    if (action === 'read' || action === openTransferFile) {
      const item = requireRecord(live, input.id);
      if (item.kind !== 'file') fail(400, '此项不是文件。');
      if (action === 'read' && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > item.size))
        fail(400, '文件位置无效。');
      if (item.protection) {
        const ticket = tickets.get(input.ticket);
        if (!ticket || ticket.id !== item.id || ticket.owner !== access.owner) fail(403, '请先输入取件密码。');
        ticket.until = now + 600000;
      }
      const file = await open(filename(item.id), 'r');
      if (action === openTransferFile) return { file, name: item.name, size: item.size };
      try {
        const buffer = Buffer.alloc(Math.min(partSize, item.size - input.offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, input.offset);
        if (!bytesRead && buffer.length) fail(500, '文件不完整。');
        access.authorize?.();
        return buffer.subarray(0, bytesRead).toString('base64');
      } finally {
        await file.close();
      }
    }
    if (action === 'remove') {
      if (access.ownDirectOnly && !direct.ownedBy(input.id, access.owner)) fail(403, '快速链接仅可撤回自己发布的直传文件。');
      if (direct.get(input.id)) { direct.remove(input.id); return {}; }
      const item = requireRecord(live, input.id);
      await commit(live.filter((row) => row !== item));
      if (item.kind === 'file') await discard(item.id);
      return {};
    }
    if (action === 'begin' || action === 'send' || action === 'publish') {
      let resumeKey;
      if (action === 'begin' && input.resumeToken !== undefined) {
        if (typeof input.resumeToken !== 'string' || !/^[0-9a-f]{64}$/.test(input.resumeToken)) fail(400, '续传凭据无效。');
        if (input.sha256 !== undefined && (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256))) fail(400, '文件 SHA-256 无效。');
        resumeKey = sessionDigest(JSON.stringify([access.owner, input.resumeToken]));
        const done = completed.get(resumeKey);
        if (done && live.some(row => row.id === done.receipt.id)) return { ...done.receipt, complete: true };
        const previous = [...pending.values()].find(row => row.resumeKey === resumeKey);
        if (previous) {
          if (previous.item.size !== input.size || previous.hours !== input.hours || previous.digest !== input.sha256) fail(409, '文件或有效期与原上传不同。');
          const lock = previous.item.protection;
          if (lock ? typeof input.password !== 'string' || input.password.length > 128 || !timingSafeEqual(await derive(input.password, lock.salt, 32), Buffer.from(lock.hash, 'hex')) : !!input.password)
            fail(409, '续传请使用原取件密码。');
          access.authorize?.();
          previous.touched = now;
          return { ...previous.receipt, offset: previous.offset };
        }
      }
      if (live.length + pending.size + direct.rows().length >= 250) fail(409, '收件箱已满，请移除旧内容。');
      if (!lifetimes.includes(input.hours)) fail(400, '请选择有效期。');
      const item = {
        ...newRecord(),
        protection: await protection(input.password),
        sender: access.actor || '主机',
        expires: now + input.hours * 3600_000,
      };
      const key = item.protection && input.rememberPickup === true ? randomBytes(32) : null;
      if (key) item.protection.publisher = sealPickup(input.password, key, item.id, access.publisherSession);
      const published = key ? { id: item.id, publisherKey: key.toString('hex'), expires: item.expires } : { id: item.id };
      if (action === 'send') {
        shortText(input.text, 64000, '内容');
        const content = input.text;
        const kind = /^https?:\/\/\S+$/i.test(content) ? 'link' : 'text';
        await commit([...live, { ...item, kind, text: content, size: Buffer.byteLength(content) }]);
        return published;
      }
      const name = shortText(input.name, 240, '文件名').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
      if (!Number.isSafeInteger(input.size) || input.size < 0) fail(400, '文件大小无效。');
      if (action === 'publish') {
        if (!item.protection) fail(400, '请设置直传取件密码。');
        access.authorize?.();
        direct.publish({ ...item, kind: 'file', direct: true, name, size: input.size }, access.owner);
        return published;
      }
      if (pending.size >= 12) fail(409, '上传通道已满，请稍后重试。');
      const disk = await statfs(folder, { bigint: true });
      const reserved = [...pending.values()].reduce((sum, up) => sum + BigInt(up.item.size - up.offset), 0n);
      if (BigInt(input.size) + reserved > disk.bavail * disk.bsize) fail(507, '共享主机磁盘空间不足。');
      access.authorize?.();
      await (await open(filename(item.id), 'wx', 0o600)).close();
      pending.set(item.id, {
        item: { ...item, name, kind: 'file', size: input.size },
        resumeKey, receipt: published, offset: 0,
        digest: input.sha256, hash: resumeKey && input.sha256 ? createHash('sha256') : undefined,
        touched: now,
        hours: input.hours,
        owner: access.owner,
      });
      return published;
    }
    if (!['part', 'finish', 'cancel'].includes(action)) fail(404, '快传操作不存在。');
    const upload = pending.get(input.id);
    if (!upload || upload.owner !== access.owner) fail(404, '上传已结束或过期。');
    if (action === 'cancel') {
      await discard(input.id);
      pending.delete(input.id);
      return {};
    }
    if (action === 'finish') {
      if (upload.offset !== upload.item.size) fail(409, '文件尚未完整接收。');
      if (upload.hash && upload.hash.copy().digest('hex') !== upload.digest) {
        await discard(input.id); pending.delete(input.id);
        fail(409, '文件内容与发送前的 SHA-256 不一致，请重新选择源文件。');
      }
      const expires = now + upload.hours * 3600_000;
      await commit([...live, { ...upload.item, expires }]);
      pending.delete(input.id);
      if (upload.resumeKey) {
        if (completed.size >= 250) completed.delete(completed.keys().next().value);
        completed.set(upload.resumeKey, { receipt: { ...upload.receipt, expires }, until: now + 600000 });
      }
      return upload.item.protection?.publisher ? { id: input.id, expires } : { id: input.id };
    }
    if (input.offset !== upload.offset) fail(409, '上传位置已变化，请重新发送。');
    if (typeof input.data !== 'string' || input.data.length > Math.ceil(partSize / 3) * 4) fail(413, '文件分块过大。');
    const bytes = Buffer.from(input.data, 'base64');
    if (
      !bytes.length ||
      bytes.length > partSize ||
      bytes.toString('base64') !== input.data ||
      upload.offset + bytes.length > upload.item.size
    )
      fail(400, '文件分块无效。');
    const file = await open(filename(input.id), 'r+');
    try {
      let written = 0;
      while (written < bytes.length)
        written += (await file.write(bytes, written, bytes.length - written, upload.offset + written)).bytesWritten;
    } finally {
      await file.close();
    }
    upload.hash?.update(bytes);
    upload.offset += bytes.length;
    upload.touched = now;
    return { offset: upload.offset };
  }
  return {
    release: direct.release,
    async request(args) {
      try {
        return await request(args);
      } catch (error) {
        if (['ENOSPC', 'EDQUOT'].includes(error.code)) fail(507, '共享主机磁盘空间不足。');
        if (error.code === 'EFBIG') fail(413, '文件超过主机文件系统支持的大小。');
        throw error;
      }
    },
    async close() {
      for (const id of pending.keys()) await discard(id);
      pending.clear();
    },
  };
}
