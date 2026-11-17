import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
export async function connectSsh(host, password, { verifyOnly = false } = {}) {
  const { default: { Client, utils } } = await import('ssh2');
  const username = host.user;
  const authentication = [];
  if (!verifyOnly && host.auth === 'password') {
    if (!password) throw new Error('请填写 SSH 密码。');
    authentication.push({ type: 'password', username, password });
    authentication.push({ type: 'keyboard-interactive', username, prompt: (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.length === 1 && !prompts[0].echo && /password|密码/i.test(prompts[0].prompt) ? [password] : []);
    } });
  } else if (!verifyOnly) {
    const agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '');
    if (agent) authentication.push({ type: 'agent', username, agent });
    for (const filename of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
      const bytes = await readFile(path.join(homedir(), '.ssh', filename)).catch(() => null);
      if (bytes) {
        const key = utils.parseKey(bytes);
        if (!(key instanceof Error) && !Array.isArray(key) && key.isPrivateKey()) authentication.push({ type: 'publickey', username, key });
      }
    }
    if (!authentication.length) throw new Error('未找到 SSH 密钥，请启动 SSH Agent、配置默认密钥或选择密码登录。');
  }
  return new Promise((resolve, reject) => {
    const client = new Client();
    let offered;
    client.once('ready', () => resolve(client));
    client.on('error', error => {
      client.destroy();
      if (offered && (verifyOnly || offered !== host.fingerprint)) {
        const message = host.fingerprint && offered !== host.fingerprint ? 'SSH 主机指纹已变化。' : '请先确认 SSH 主机指纹。';
        reject(Object.assign(new Error(message), { fingerprint: offered }));
      } else reject(new Error(error.level === 'client-authentication' ? 'SSH 身份验证失败，请检查用户名和登录凭据。' : `SSH 连接失败：${error.message}`));
    });
    client.once('close', () => reject(new Error('SSH 连接已关闭。')));
    try {
      client.connect({ host: host.address, port: host.port, username, readyTimeout: 12000, keepaliveInterval: 15000, keepaliveCountMax: 3,
        authHandler: authentication, tryKeyboard: true,
        hostVerifier(key) {
          offered = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          return !verifyOnly && offered === host.fingerprint;
        },
      });
    } catch (error) { client.destroy(); reject(error); }
  });
}

const managerFiles = [
  'server/ssh-workspace-agent.mjs', 'server/ssh-windows-process.mjs', 'server/ssh-lines.mjs', 'server/managed-workspace.mjs', 'server/project-lock.mjs', 'server/atomic-file.mjs',
  ...['manager', 'process', 'policies', 'supervisor-client', 'supervisor-worker', 'autostart', 'configs', 'log-writer', 'console'].map(name => `server/jar-${name}.mjs`),
  ...['manager', 'process', 'create', 'inspection', 'directories'].map(name => `server/nginx-${name}.mjs`), 'shared/nginx.mjs',
];
const call = (receiver, method, ...args) => new Promise((resolve, reject) => receiver[method](...args, (error, result) => error ? reject(error) : resolve(result)));
let bundle;
async function managerBundle() {
  return bundle ??= Promise.all(managerFiles.map(async name => [name, await readFile(new URL(`../${name}`, import.meta.url))])).then(files => {
    const hash = createHash('sha256');
    for (const [name, bytes] of files) hash.update(name).update(bytes);
    return { files, folder: `.devkit-ssh/workspaces/${hash.digest('hex').slice(0, 24)}` };
  });
}
async function deploy(client) {
  const { files, folder } = await managerBundle();
  const sftp = await call(client, 'sftp');
  try {
    async function mkdir(directory) {
      try { await call(sftp, 'mkdir', directory, { mode: 0o700 }); }
      catch (error) { if (!(await call(sftp, 'stat', directory).catch(() => null))?.isDirectory()) throw error; }
    }
    if (!(await call(sftp, 'stat', `${folder}/ready`).catch(() => null))?.isFile()) {
      for (const directory of ['.devkit-ssh', '.devkit-ssh/workspaces', folder, `${folder}/server`, `${folder}/shared`]) await mkdir(directory);
      for (const [name, bytes] of files) {
        const target = `${folder}/${name}`, temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await call(sftp, 'writeFile', temporary, bytes, { mode: 0o600, flag: 'wx' });
          await call(sftp, 'rename', temporary, target).catch(async error => {
            const existing = await call(sftp, 'readFile', target).catch(() => null);
            if (!existing?.equals(bytes)) throw error;
          });
        } finally { await call(sftp, 'unlink', temporary).catch(() => {}); }
      }
      await call(sftp, 'writeFile', `${folder}/ready`, 'ready', { mode: 0o600 });
    }
  } finally { sftp.end(); }
  return call(client, 'exec', `node ${folder}/server/ssh-workspace-agent.mjs`);
}

export async function openSshAgent(host, password) {
  if (!host.fingerprint) throw new Error('请在局域网主机中测试连接并确认 SSH 主机指纹。');
  const client = await connectSsh(host, password);
  const timer = setTimeout(() => client.destroy(), 30000);
  try { return { client, stream: await deploy(client) }; }
  catch (error) { client.destroy(); throw error; }
  finally { clearTimeout(timer); }
}

export async function openSshShell(host, password, size) {
  const client = await connectSsh(host, password);
  const timer = setTimeout(() => client.destroy(), 12000);
  try { return { client, stream: await call(client, 'shell', { term: 'xterm-256color', ...size }) }; }
  catch (error) { client.destroy(); throw error; }
  finally { clearTimeout(timer); }
}

export async function runSshCommand(host, password, command, input) {
  const client = await connectSsh(host, password);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { client.destroy(); reject(new Error('旧版实例状态检查超时。')); }, 30000);
      const finish = (error, result) => { clearTimeout(timer); if (error) reject(error); else resolve(result); };
      client.once('close', () => finish(new Error('SSH 连接已关闭。')));
      client.exec(command, (error, stream) => {
        if (error) { finish(error); return; }
        let stdout = '', stderr = '';
        stream.on('data', chunk => { stdout = (stdout + chunk).slice(-4000); });
        stream.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
        stream.on('error', finish);
        stream.once('close', code => finish(code ? new Error(stderr.trim() || stdout.trim() || '旧版实例状态检查失败。') : null, stdout));
        stream.end(input);
      });
    });
  } finally { client.end(); }
}
