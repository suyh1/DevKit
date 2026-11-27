import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { atomicFile } from './atomic-file.mjs';
import { routingAddress } from './relay-routing.mjs';
import { routingManagementSession } from './relay-routing-apply.mjs';
import { gatewayInventory, gatewayNetworks, gatewaySnapshot, usableGatewayBlock } from './relay-gateway.mjs';
import { directRoutePlan } from './relay-gateway-routes.mjs';
import { gatewayFiles } from './relay-gateway-config.mjs';
import { directClient, gatewayOperation, tunnelAddress } from './relay-gateway-operations.mjs';

const labels = { forward:'启用接口转发', route:'配置访问路由', files:'准备 WireGuard 组件', tunnel:'启用隧道', nat:'配置回程地址转换', firewall:'放行隧道端口', handshake:'验证隧道握手' };
const device = role => role === 'A' ? 'A' : '访问设备';
const brief = row => row ? { id:row.id, a:row.a, phase:row.phase, message:row.message, mode:row.mode } : { phase:'idle', message:'' };

export async function planGateway(input, hosts, check) {
  const inspect = host => ({ platform:host.platform, run:script => host.run(script,{ privileged:false }) });
  const snapshot = await gatewaySnapshot(input.a,inspect(hosts.A));
  check();
  if (!snapshot.links.length) throw Error('A 没有可用于转发的 IPv4 接口。');
  const local = await gatewayInventory(inspect(hosts.B));
  const clientIPs = local.addresses.map(link => link.cidr.split('/')[0]);
  if (snapshot.links.some(link => clientIPs.includes(link.address))) throw Error('请选择不同于 A 且地址唯一的访问设备。');
  const networks = gatewayNetworks(input.networks);
  if (!networks.length) throw Error('请至少选择一个目的网段。');
  const links = [...snapshot.links].sort((x,y) => Number(y.address === input.a) - Number(x.address === input.a));
  const direct = input.mode !== 'tunnel' && await directClient(inspect(hosts.B),links.map(l => l.address));
  check();
  const forward = [...new Set(links.map(l => l.address))].map(ip => ({ role:'A', kind:'forward', ip }));
  if (direct) {
    const plan = directRoutePlan(networks,links,snapshot.routes);
    const routes = plan(links.find(l => l.address === direct.via)).flatMap(entry => {
      const [cidr,...gateways] = entry.split(' ');
      return gateways.some(ip => clientIPs.includes(ip)) ? [] : [{ role:'B', kind:'route', cidr, ...direct }];
    });
    return { mode:'direct', steps:routes.length ? [...forward,...routes] : [], alreadyLocal:!routes.length };
  }
  if (input.mode === 'direct') throw Error('访问设备需要经其他网关连接 A，请选择自动接入或三层隧道。');
  const localNetworks = [...new Set(local.addresses.map(l => usableGatewayBlock(l.cidr)?.cidr).filter(Boolean))];
  const clientRoutes = local.routes.map(r => usableGatewayBlock(r.network)?.cidr).filter(Boolean);
  const used = [...(local.previous ?? []),...(local.managed ?? [])].map(cidr => usableGatewayBlock(cidr)?.cidr).filter(Boolean);
  const selected = { ...snapshot, occupiedTunnels:[...new Set([...(snapshot.occupiedTunnels ?? []), ...clientRoutes, ...used])], mode:'tunnel', port:input.port, networks, local:{ B:[...localNetworks,...gatewayNetworks(input.localNetworks ?? [])] }, previousTunnel:undefined, discovered:[...snapshot.networks, ...(snapshot.previousTunnel ? [snapshot.previousTunnel] : [])] };
  const files = gatewayFiles(selected), { hub, network } = tunnelAddress(files['A/devkit-a.conf']);
  const tag = randomUUID().replaceAll('-','').slice(0,12);
  const step = (role,kind,extra) => ({ role, kind, tag, ...extra });
  return { mode:'tunnel', configs:{ A:files['A/devkit-a.conf'], B:files['B/devkit-b.conf'] }, steps:[
    step('A','files'), step('B','files'), step('A','tunnel'), step('B','tunnel'),
    ...forward, { role:'A', kind:'forward', ip:hub, transient:true }, step('A','nat',{ network }),
    ...(hosts.A.platform === 'win32' ? [step('A','firewall',{ port:input.port ?? 51820 })] : []),
    step('B','handshake',{ ip:hub }),
  ] };
}

export async function createGatewayDeployment(file, lan, {
  interfaces = networkInterfaces, connect = routingManagementSession, plan = planGateway, command = gatewayOperation,
} = {}) {
  let row, running, cancelled = false;
  try { row = JSON.parse(await readFile(file,'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const save = () => atomicFile(file, JSON.stringify(row));
  const check = () => { if (cancelled) throw Error('已取消部署'); };
  const localIPs = () => Object.values(interfaces()).flat().map(i => i?.address);
  async function identify(address, id, profiles) {
    if (!address || localIPs().includes(address)) return { local:true };
    routingAddress(address);
    const matches = profiles.filter(h => h.mode === 'ssh' && h.address === address && h.fingerprint);
    const found = id ? matches.find(h => h.id === id) : matches.length === 1 && matches[0];
    if (!found) throw Error('请为 ' + address + ' 选择已确认指纹的 SSH 管理档案。');
    return { id:found.id, address, fingerprint:found.fingerprint };
  }
  async function open(role) {
    const ref = row.devices[role];
    if (!ref.local) {
      const profiles = await lan.hostRequest('list');
      if (!profiles.some(h => h.id === ref.id && h.address === ref.address && h.fingerprint === ref.fingerprint && h.mode === 'ssh'))
        throw Error('管理档案或主机指纹已变化，请恢复原设备的管理连接。');
    }
    return connect(lan, ref.id, { elevated:true, interactive:ref.local, maxOutput:2*1024*1024 });
  }
  const runStep = (host,op,action,config) => host.run(command(host.platform,op,action,config), {
    privileged:!['state','owned'].includes(action) || ['nat','firewall','handshake'].includes(op.kind) || (host.platform === 'win32' && op.kind === 'files'),
    timeout:op.kind === 'files' && action === 'add' ? 180000 : undefined,
  });
  async function undo() {
    const hosts = {}, failed = new Set(), messages = [];
    const original = row.reason || '已取消部署';
    row.phase = 'restoring'; row.message = '正在恢复部署前的网络设置…'; await save();
    try {
      for (const op of [...row.pending].reverse()) {
        // Keep a device's prerequisites if a dependent operation could not be removed.
        if (failed.has(op.role)) continue;
        try {
          const host = hosts[op.role] ??= await open(op.role);
          const state = await runStep(host,op,'owned');
          if (state === 'present' || state === 'partial') {
            await runStep(host,op,'undo');
            if (['present','partial'].includes(await runStep(host,op,'owned'))) throw Error('仍检测到本次配置');
          } else if (state !== 'missing' && state !== 'local') throw Error('设备状态无法确认');
          row.pending.splice(row.pending.indexOf(op),1); await save();
        } catch (e) {
          failed.add(op.role); messages.push(device(op.role) + ' ' + labels[op.kind] + '：' + e.message);
        }
      }
      row.phase = row.pending.length ? 'cleanup' : 'restored';
      row.message = row.pending.length ? original + '。部分设置待恢复：' + messages.join('；') : original + '。已恢复部署前的网络设置。';
      await save();
    } finally { for (const host of Object.values(hosts)) host.close(); }
  }
  async function deploy(input) {
    const hosts = {};
    try {
      const profiles = lan && (!localIPs().includes(input.a) || input.client) ? await lan.hostRequest('list') : [];
      row.devices.A = await identify(input.a,input.profile,profiles);
      row.devices.B = await identify(input.client,input.clientProfile,profiles);
      if (row.devices.A.local && row.devices.B.local) throw Error('DevKit 在 A 上，请填写要接入的访问设备地址。');
      for (const role of ['A','B']) {
        check(); row.message = '正在连接' + device(role) + '…'; hosts[role] = await open(role);
      }
      row.message = '正在检查 A 和访问设备的路由…';
      const result = await plan(input,hosts,check);
      row.mode = result.mode;
      for (const step of result.steps) {
        const op = { ...step };
        if (op.kind === 'route') op.metric = randomInt(1,65536);
        if (op.kind === 'forward') op.owner = row.id;
        check();
        row.message = device(op.role) + ' · ' + labels[op.kind] + (op.cidr ? ' ' + op.cidr : '');
        const host = hosts[op.role];
        const run = (action,config) => runStep(host,op,action,config);
        const state = await run('state');
        if (op.kind === 'handshake') {
          if (state !== 'present') throw Error('未检测到隧道握手');
          continue;
        }
        if (state === 'present' && ['files','tunnel'].includes(op.kind)) throw Error('同名的隧道或目录已存在。');
        if (state === 'present' || state === 'local') continue;
        if (state !== 'missing') throw Error('无法确定部署前的网络状态。');
        check();
        // Write intent before touching the OS, including commands whose SSH response can be lost.
        row.pending.push(op); await save(); check();
        await run('add', result.configs?.[op.role]);
        if (await run('state') !== 'present') throw Error('设备未应用预期配置。');
      }
      check();
      row.phase = 'active';
      row.message = result.alreadyLocal ? '所选网段沿用访问设备的现有路由，请使用目标设备的原 IP 和端口访问。' :
        (result.mode === 'direct' ? 'A 的转发和访问设备的路由已就绪。目标侧须有返回访问设备的路由。' : '已验证 A 与访问设备的隧道握手。') + '请使用目标设备的原 IP 和端口访问。';
      await save(); check();
    } catch (e) {
      row.reason = cancelled ? '已取消部署' : '部署失败（' + row.message + '）：' + e.message;
      await undo();
    } finally { for (const h of Object.values(hosts)) h.close(); }
  }
  function work(job) {
    running = Promise.resolve().then(job).catch(e => {
      row.phase = 'cleanup'; row.message = '恢复记录未能完成，请重试：' + e.message;
    }).finally(() => { running = undefined; });
  }
  if (row && ['deploying','cancelling','restoring'].includes(row.phase)) {
    row.reason ||= '上次部署被中断'; work(undo);
  }
  return {
    status:() => brief(row),
    start(input) {
      if (running || (row && !['restored'].includes(row.phase))) throw Error('请先取消当前部署并完成恢复。');
      const a = routingAddress(input.a,' A ');
      if (!['auto','direct','tunnel'].includes(input.mode)) throw Error('请选择接入方式。');
      const networks = gatewayNetworks(input.networks);
      if (!networks.length) throw Error('请至少选择一个目的网段。');
      if (input.client) routingAddress(input.client,'访问设备');
      cancelled = false;
      row = { id:randomUUID(), a, mode:input.mode, phase:'deploying', message:'正在检查 A 和访问设备的网络…', devices:{}, pending:[] };
      work(async () => { await save(); await deploy({ ...input, a, networks }); });
      return brief(row);
    },
    cancel(id) {
      if (!row || row.id !== id) throw Error('部署已变化，请刷新状态。');
      if (row.phase === 'deploying' || (row.phase === 'active' && running)) {
        cancelled = true; row.phase = 'cancelling'; row.message = '正在等待当前步骤结束并恢复…';
      } else if (!running && ['active','cleanup'].includes(row.phase)) {
        row.reason ||= '已取消部署'; work(undo);
      }
      return brief(row);
    },
    async settled() { await running; return brief(row); },
  };
}
