import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { sshCall } from './ssh-exec.mjs';
import { deploySshWorkspace } from './ssh-workspace-deploy.mjs';
export { sshCall, sshOutput } from './ssh-exec.mjs';
export async function connectSsh(host, password, { verifyOnly = false, socket, privateKey } = {}) {
  const { default: { Client, utils } } = await import('ssh2');
  const username = host.user;
  const authentication = [];
  const authError = message => Object.assign(new Error(message), { sshStage: 'auth' });
  if (!verifyOnly && host.auth === 'password') {
    if (!password) throw authError('请填写 SSH 密码。');
    authentication.push({ type: 'password', username, password });
    authentication.push({ type: 'keyboard-interactive', username, prompt: (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.length === 1 && !prompts[0].echo && /password|密码/i.test(prompts[0].prompt) ? [password] : []);
    } });
  } else if (!verifyOnly && (host.keyPath || privateKey)) {
    let key;
    try {
      if (privateKey) key = utils.parseKey(privateKey, password || undefined);
      else {
        if (!(await stat(host.keyPath)).isFile()) throw new Error('请选择普通文件。');
        const file = await open(host.keyPath, 'r');
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > 262144) throw new Error('私钥文件过大或不可读取。');
          const bytes = Buffer.alloc(info.size);
          const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
          key = utils.parseKey(bytes.subarray(0, bytesRead), password || undefined);
        } finally { await file.close(); }
      }
    } catch { throw authError('无法读取已配置的 SSH 私钥。'); }
    if (key instanceof Error || Array.isArray(key) || !key.isPrivateKey()) throw authError('私钥格式无效，或解锁口令不正确。');
    authentication.push({ type: 'publickey', username, key });
  } else if (!verifyOnly) {
    if (host.explicitKeyOnly) throw authError('请为此主机配置 SSH 私钥或密码。');
    const agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '');
    if (agent) authentication.push({ type: 'agent', username, agent });
    for (const filename of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
      const bytes = await readFile(path.join(homedir(), '.ssh', filename)).catch(() => null);
      if (bytes) {
        const key = utils.parseKey(bytes);
        if (!(key instanceof Error) && !Array.isArray(key) && key.isPrivateKey()) authentication.push({ type: 'publickey', username, key });
      }
    }
    if (!authentication.length) throw authError('未找到 SSH 密钥，请启动 SSH Agent、配置默认密钥或选择密码登录。');
  }
  return new Promise((resolve, reject) => {
    const client = new Client();
    let offered;
    client.once('ready', () => { client.setNoDelay(true); resolve(client); });
    client.on('error', error => {
      client.destroy();
      if (offered && (verifyOnly || offered !== host.fingerprint)) {
        const message = host.fingerprint && offered !== host.fingerprint ? 'SSH 主机指纹已变化。' : '请先确认 SSH 主机指纹。';
        reject(Object.assign(new Error(message), { fingerprint: offered }));
      } else {
        const authenticationFailed = error.level === 'client-authentication';
        const reason = error.message?.trim() || error.code || '请检查目标地址、SSH 端口及服务状态。';
        reject(Object.assign(new Error(authenticationFailed ? 'SSH 身份验证失败，请检查用户名和登录凭据。' : `SSH 连接失败：${reason}`), { sshStage: authenticationFailed ? 'auth' : 'handshake' }));
      }
    });
    client.once('close', () => reject(new Error('SSH 连接已关闭。')));
    try {
      client.connect({ host: host.address, port: host.port, username, sock: socket, readyTimeout: 12000, keepaliveInterval: 15000, keepaliveCountMax: 3,
        authHandler: authentication, tryKeyboard: true,
        hostVerifier(key) {
          offered = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          return !verifyOnly && offered === host.fingerprint;
        },
      });
    } catch (error) { client.destroy(); reject(error); }
  });
}

export async function openSshAgent(client, preferred, options) {
  const timer = setTimeout(() => client.destroy(), 330000);
  try { return { client, ...await deploySshWorkspace(client, preferred, options) }; }
  catch (error) { client.destroy(); throw error; }
  finally { clearTimeout(timer); }
}

export async function openSshShell(client, size) {
  const timer = setTimeout(() => client.destroy(), 12000);
  try { return { client, stream: await sshCall(client, 'shell', { term: 'xterm-256color', ...size }) }; }
  catch (error) { client.destroy(); throw error; }
  finally { clearTimeout(timer); }
}

export async function runSshCommand(client, command, input) {
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
