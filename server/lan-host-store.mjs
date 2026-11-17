import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';

const fingerprintPattern = /^SHA256:[A-Za-z0-9+/]{43}$/;
function normalize(value, existing) {
  const { mode, address, name, user, port, platform, auth } = value ?? {};
  if (!['share', 'ssh'].includes(mode) || typeof name !== 'string' || name.length > 120 || typeof address !== 'string' || !address.trim() || address.length > 2048) throw new Error('请填写有效的主机名称和地址。');
  const host = { id: existing?.id || randomUUID(), mode, name: name.trim(), modules: { jar: value.modules?.jar === true, nginx: value.modules?.nginx === true } };
  if (mode === 'share') {
    const url = new URL(address.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('请填写完整的 HTTP(S) 共享地址。');
    host.address = url.origin;
  } else {
    host.address = address.trim().replace(/^\[([^\]]+)\]$/, '$1').toLowerCase();
    if (host.address.length > 253 || (!isIP(host.address) && !/^[a-z0-9][a-z0-9.-]*$/i.test(host.address))) throw new Error('请输入 SSH 主机名或 IP 地址。');
    if (typeof user !== 'string' || !/^[a-z0-9_.@\\-]{1,120}$/i.test(user.trim()) || !Number.isInteger(port) || port < 1 || port > 65535 || !['linux', 'win32'].includes(platform)) throw new Error('SSH 用户名、端口或目标系统无效。');
    Object.assign(host, { user: user.trim(), port, platform, auth: auth === 'password' ? 'password' : 'key' });
  }
  host.name ||= host.address;
  if (existing && (!sameServer(existing, host) || existing.user !== host.user)) host.id = randomUUID();
  if (existing && sameServer(existing, host)) {
    if (existing.fingerprint) host.fingerprint = existing.fingerprint;
    if (existing.user === host.user && existing.auth === host.auth && existing.secret) host.secret = existing.secret;
  }
  return host;
}
function sameServer(a, b) { return a.mode === b.mode && a.address === b.address && a.port === b.port; }
export function publicHost({ secret, ...host }) { return { ...host, hasPassword: !!secret }; }

export async function createLanHostStore(directory) {
  const folder = path.join(directory, 'lan-hosts');
  const registry = path.join(folder, 'connections.json'), keyFile = path.join(folder, 'credentials.key');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let key;
  async function loadKey(create) {
    if (key) return key;
    if (create) await writeFile(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    key = await readFile(keyFile);
    if (key.length !== 32) { key = undefined; throw new Error('局域网主机凭据密钥无效。'); }
    return key;
  }
  const stored = await readFile(registry, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (!Array.isArray(stored)) throw new Error('局域网主机连接档案格式无效。');
  let hosts = stored, queue = Promise.resolve();
  function update(change) {
    const pending = queue.then(async () => {
      const next = await change(hosts);
      if (next !== hosts) { await atomicFile(registry, JSON.stringify(next, null, 2)); hosts = next; }
      return hosts.map(publicHost);
    });
    queue = pending.catch(() => {});
    return pending;
  }
  async function save(value, existing) {
    const host = normalize(value, existing);
    if (value.clearPassword === true) delete host.secret;
    if (value.password !== undefined && value.password !== '') {
      if (typeof value.password !== 'string' || value.password.length > (host.mode === 'share' ? 128 : 4096)) throw new Error('密码长度无效。');
      if (host.mode === 'share' || host.auth === 'password') {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await loadKey(true), iv);
        cipher.setAAD(Buffer.from(host.id));
        const bytes = Buffer.concat([cipher.update(value.password, 'utf8'), cipher.final()]);
        host.secret = Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
      }
    }
    return host;
  }
  return {
    list: () => hosts,
    async password(host) {
      if (!host.secret) return '';
      const bytes = Buffer.from(host.secret, 'base64'), decipher = createDecipheriv('aes-256-gcm', await loadKey(false), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(host.id));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
    save: value => update(async current => {
      const existing = current.find(item => item.id === value?.id);
      if (value?.id && !existing) throw new Error('主机连接已不存在。');
      const next = await save(value, existing);
      if (current.some(item => item !== existing && sameServer(item, next) && item.user === next.user)) throw new Error('此连接已保存。');
      if (!existing && current.length >= 50) throw new Error('最多保存 50 台主机。');
      return existing ? current.map(item => item === existing ? next : item) : [...current, next];
    }),
    import: values => update(current => {
      const next = [...current];
      for (const value of Array.isArray(values) ? values.slice(0, 50) : []) {
        try {
          const host = normalize(value);
          if (next.length < 50 && !next.some(item => sameServer(item, host) && item.user === host.user)) next.push(host);
        } catch { /* Skip malformed records left by older versions. */ }
      }
      return next.length === current.length ? current : next;
    }),
    remove: id => update(current => current.filter(host => host.id !== id)),
    trust: (expected, fingerprint, reset = false) => update(current => {
      if (!reset && !fingerprintPattern.test(fingerprint)) throw new Error('主机指纹无效。');
      const host = current.find(item => item === expected);
      if (!host) throw new Error('主机档案已变更，请重新连接。');
      if (!reset && host.fingerprint && host.fingerprint !== fingerprint) throw new Error('SSH 主机指纹已变化。请核对目标机后重置已信任的指纹。');
      return current.map(item => item === host ? { ...host, fingerprint: reset ? undefined : fingerprint } : item);
    }),
  };
}
