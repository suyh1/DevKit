import { hostTarget, portDetails, probePort, resolveAddress } from './lan-probe.mjs';
import { sshOutput } from './ssh-exec.mjs';
import { closeSftp, detectSshTarget, trySftp } from './ssh-workspace-deploy.mjs';
import { sshNodeAsset, sshNodeVersion } from './ssh-node-runtimes.mjs';

export async function diagnoseHost(host, { openSsh, openShare, openPort = probePort, resolve = resolveAddress }) {
  const { address, port } = hostTarget(host);
  const checks = [];
  const checkedAt = new Date().toISOString();
  let fingerprint;
  const record = (name, state, detail) => checks.push({ name, state, detail });
  async function check(name, run) {
    try { record(name, 'pass', await run()); return true; }
    catch (error) { record(name, 'fail', error.message); return false; }
  }

  if (host.jumpHostId) {
    record('地址解析和端口', 'skip', '由跳板机访问目标地址，结果见下方 SSH 握手。');
  } else {
    if (!await check('地址解析', async () => (await resolve(address)).join('、'))) return { checks, checkedAt };
    if (!await check('TCP 端口', async () => {
      const result = await openPort(address, port);
      if (!result.ok) throw new Error(`${port} · ${portDetails[result.code] || result.code}`);
      return `${port} · ${result.elapsed} ms`;
    })) return { checks, checkedAt };
  }

  const modules = ['jar', 'nginx'].filter(module => host.modules[module]);
  if (host.mode === 'share') {
    let transport;
    if (await check('DevKit 共享认证', async () => { transport = await openShare(); await transport.capabilities('jar'); return '共享口令有效'; })) {
      for (const module of modules) await check(module === 'jar' ? '服务管理' : 'Nginx 配置', async () => {
        await transport.request(module, 'get', {});
        const { edit, control } = await transport.capabilities(module);
        return ['查看', edit && '编辑', control && '运行'].filter(Boolean).join('、');
      });
    }
    return { checks, checkedAt };
  }

  let client;
  try {
    client = await openSsh({ verifyOnly: !host.fingerprint });
    record('SSH 主机指纹', 'pass', host.fingerprint);
    record('SSH 登录', 'pass', '认证成功');
  } catch (error) {
    if (error.fingerprint && !error.jump && !host.fingerprint) fingerprint = error.fingerprint;
    if (error.fingerprint || error.sshStage === 'auth') record('SSH 主机指纹', error.fingerprint ? 'fail' : 'pass', error.fingerprint || host.fingerprint);
    if (!fingerprint) record(error.sshStage === 'auth' ? 'SSH 登录' : 'SSH 握手', 'fail', error.message);
    return { checks, checkedAt, fingerprint };
  }
  try {
    if (modules.length) {
      const sftp = await trySftp(client);
      await check('部署通道', async () => { await closeSftp(sftp); return sftp ? '优先通过 SFTP 上传' : '通过 SSH 命令通道上传'; });
      await check('远程运行时', async () => {
        const target = await detectSshTarget(client, host.platform);
        if (await sshNodeAsset(target.key)) return `${target.key} · 内置 Node.js v${sshNodeVersion} 将在首次管理时部署`;
        const version = await sshOutput(client, 'node --version');
        if (Number(/^v(\d+)\./.exec(version)?.[1] || 0) < 24) throw new Error(`${target.key} 需要 SSH 会话可执行 Node.js 24+`);
        return `${target.key} · 使用目标机 ${version}`;
      });
      if (host.modules.jar) await check('Java', () => sshOutput(client, 'java -version'));
      if (host.modules.nginx) await check('Nginx', () => sshOutput(client, 'nginx -v'));
    }
  } finally { client.destroy(); }
  return { checks, checkedAt };
}
