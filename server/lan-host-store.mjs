import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import { userInfo } from 'node:os';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';
import { normalizeMac } from './lan-power.mjs';

const fingerprintPattern = /^SHA256:[A-Za-z0-9+/]{43}$/;
function label(value, max) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error('主机分组或标签无效。');
  return value.trim();
}
function normalize(value, existing) {
  const { mode, address, name, user, port, platform, auth } = value ?? {};
  if (!['share', 'ssh'].includes(mode) || typeof name !== 'string' || name.length > 120 || typeof address !== 'string' || !address.trim() || address.length > 2048) throw new Error('请填写有效的主机名称和地址。');
  const host = { id: existing?.id || randomUUID(), mode, name: name.trim(), modules: { jar: value.modules?.jar === true, nginx: value.modules?.nginx === true } };
  const group = label(value.group, 60);
  if (group) host.group = group;
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > 12) throw new Error('每台主机最多支持 12 个标签。');
    const tags = [...new Set(value.tags.map(tag => label(tag, 40)).filter(Boolean))];
    if (tags.length) host.tags = tags;
  }
  if (value.pinned === true) host.pinned = true;
  if (value.mac != null && value.mac !== '') host.mac = normalizeMac(value.mac);
  if (value.rdpPort != null && value.rdpPort !== 0) {
    if (!Number.isInteger(value.rdpPort) || value.rdpPort < 1 || value.rdpPort > 65535) throw new Error('远程桌面端口无效。');
    host.rdpPort = value.rdpPort;
  }
  if (mode === 'share') {
    const url = new URL(address.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('请填写完整的 HTTP(S) 共享地址。');
    host.address = url.origin;
    const visitor = label(value.visitor, 48);
    if (visitor) {
      if (!/^[\p{L}\p{N}_.-]{1,48}$/u.test(visitor)) throw new Error('共享访客名称无效。');
      host.visitor = visitor.normalize('NFC');
    }
  } else {
    host.address = address.trim().replace(/^\[([^\]]+)\]$/, '$1').toLowerCase();
    if (host.address.length > 253 || (!isIP(host.address) && !/^[a-z0-9][a-z0-9.-]*$/i.test(host.address))) throw new Error('请输入 SSH 主机名或 IP 地址。');
    if (typeof user !== 'string' || !/^[a-z0-9_.@\\-]{1,120}$/i.test(user.trim()) || !Number.isInteger(port) || port < 1 || port > 65535 || !['linux', 'win32'].includes(platform)) throw new Error('SSH 用户名、端口或目标系统无效。');
    Object.assign(host, { user: user.trim(), port, platform, auth: auth === 'password' ? 'password' : 'key' });
    if (host.auth === 'key' && value.keyPath) {
      if (typeof value.keyPath !== 'string' || value.keyPath.length > 4096 || !path.isAbsolute(value.keyPath) || /[\x00-\x1f]/.test(value.keyPath)) throw new Error('请选择有效的本地 SSH 私钥文件。');
      host.keyPath = value.keyPath;
    }
    if (value.jumpHostId) {
      if (typeof value.jumpHostId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.jumpHostId)) throw new Error('跳板机标识无效。');
      host.jumpHostId = value.jumpHostId;
    }
  }
  host.name ||= host.address;
  if (existing && (!sameEndpoint(existing, host) || existing.user !== host.user)) host.id = randomUUID();
  if (existing && sameEndpoint(existing, host)) {
    if (existing.jumpHostId === host.jumpHostId && existing.fingerprint) host.fingerprint = existing.fingerprint;
    if (existing.user === host.user && existing.visitor === host.visitor && existing.auth === host.auth && existing.keyPath === host.keyPath && existing.secret) host.secret = existing.secret;
  }
  return host;
}
function sameEndpoint(a, b) { return a.mode === b.mode && a.address === b.address && a.port === b.port; }
function sameServer(a, b) { return sameEndpoint(a, b) && a.jumpHostId === b.jumpHostId; }
export function publicHost({ secret, ...host }) { return { ...host, hasPassword: !!secret }; }

export function jumpRoute(host, find) {
  const route = [], seen = new Set([host.id]);
  let id = host.jumpHostId;
  while (id) {
    if (seen.has(id)) throw new Error('SSH 跳板机不能形成循环。');
    if (route.length >= 4) throw new Error('最多使用四级 SSH 跳板机。');
    const jump = find(id);
    if (jump?.mode !== 'ssh') throw new Error('SSH 跳板机已移除或不可用，请更新主机档案。');
    route.unshift(jump); seen.add(id); id = jump.jumpHostId;
  }
  return route;
}

function planImport(current, values) {
  if (!Array.isArray(values) || values.length > 200) throw new Error('每次最多预览 200 条连接。');
  const next = [...current];
  const rows = values.map((value, index) => {
    try {
      const host = normalize({ ...value, keyPath: undefined, jumpHostId: undefined, user: value?.user || userInfo().username });
      if (next.some(item => sameServer(item, host) && item.user === host.user)) return { index, host: publicHost(host), error: '重复连接' };
      if (next.length >= 50) return { index, host: publicHost(host), error: '已达 50 台主机上限' };
      next.push(host);
      return { index, host: publicHost(host) };
    } catch (error) { return { index, error: error.message }; }
  });
  return { next, rows };
}

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
      if (host.mode === 'share' || host.auth === 'password' || host.keyPath) {
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
    previewImport: values => planImport(hosts, values).rows,
    importConnections: values => update(current => {
      const { next } = planImport(current, values);
      return next.length === current.length ? current : next;
    }),
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
      if (existing?.jumpHostId !== next.jumpHostId || next.id !== existing?.id && next.jumpHostId) {
        const find = id => current.find(item => item.id === id);
        const afterChange = id => id === next.id ? next : id === existing?.id ? undefined : find(id);
        jumpRoute(next, afterChange);
        if (existing?.id === next.id) {
          for (const dependent of current) {
            let route;
            try { route = jumpRoute(dependent, find); } catch { continue; }
            if (route.includes(existing)) jumpRoute(dependent, afterChange);
          }
        }
      }
      if (current.some(item => item !== existing && sameServer(item, next) && item.user === next.user)) throw new Error('此连接已保存。');
      if (!existing && current.length >= 50) throw new Error('最多保存 50 台主机。');
      return existing ? current.map(item => item === existing ? next : item) : [...current, next];
    }),
    import: values => update(current => {
      const next = [...current];
      for (const value of Array.isArray(values) ? values.slice(0, 50) : []) {
        try {
          const host = normalize({ ...value, keyPath: undefined, jumpHostId: undefined });
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
