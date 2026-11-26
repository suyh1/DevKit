import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { sshExec } from './ssh-exec.mjs';
import { normalizeRouting } from './relay-routing.mjs';

const roles = ['A', 'B', 'C'];
const limit = 15000;
function localCommand(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { windowsHide: true, timeout: limit, maxBuffer: 65536 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message)); else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
export async function routingManagementSession(lan, id) {
  const remote = id ? await lan.routingSession(id) : null;
  const platform = remote?.platform || process.platform;
  if (!['linux', 'win32'].includes(platform)) { remote?.client.destroy(); throw new Error('自动配置支持 Windows 和 Linux。'); }
  return {
    platform, close: () => remote?.client.destroy(),
    run(script) {
      if (platform === 'win32') {
        const command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; try { " + script + " } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
        const args = ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command, 'utf16le').toString('base64')];
        return remote ? sshExec(remote.client, 'powershell.exe ' + args.join(' '), { timeout: limit }) : localCommand('powershell.exe', args);
      }
      const input = 'set -eu\nexport LC_ALL=C\n' + script + '\n';
      // Elevation must already be available to this explicitly selected management identity.
      const command = 'if [ "$(id -u)" = 0 ]; then exec sh -s; else exec sudo -n sh -s; fi';
      return remote ? sshExec(remote.client, command, { input: Readable.from([input]), timeout: limit }) : localCommand('sh', ['-c', command], input);
    },
  };
}
function linuxDevice(ip) {
  return `dev=$(ip -o -4 addr show to ${ip}/32 | awk 'NR==1 {sub(/@.*/, "", $2); print $2}'); [ -n "$dev" ] || { echo '设备没有方案中的地址 ${ip}' >&2; exit 1; }`;
}
function checkedFile(label, prefix, path, contents) {
  const init = prefix + '\nfile=' + path + '\nexpected=' + contents;
  return { label, init,
    state: 'if [ ! -e "$file" ]; then echo missing; elif [ -f "$file" ] && [ ! -L "$file" ] && [ "$(cat "$file")" = "$expected" ]; then echo present; else echo "已有冲突配置 $file" >&2; exit 1; fi',
    add: 'mkdir -p "$(dirname "$file")"; (set -C; printf "%s\\n" "$expected" > "$file")',
    undo: '[ ! -f "$file" ] || { [ "$(cat "$file")" = "$expected" ] && rm -- "$file"; }',
  };
}
function linuxOperations(plan, role) {
  if (role === 'A') return [...new Set([plan.ab,plan.ac])].flatMap(ip => {
    const init = linuxDevice(ip);
    return [
      checkedFile(ip + ' 转发持久配置', init, '"/etc/sysctl.d/95-devkit-route-' + ip + '.conf"', '"net/ipv4/conf/$dev/forwarding=1"'),
      { label: ip + ' IPv4 转发', init, state: 'case "$(cat /proc/sys/net/ipv4/conf/"$dev"/forwarding)" in 1) echo present;; 0) echo missing;; *) exit 1;; esac',
        add: 'sysctl -qw "net/ipv4/conf/$dev/forwarding=1"', undo: 'sysctl -qw "net/ipv4/conf/$dev/forwarding=0"' },
    ];
  });
  const local = role === 'B' ? plan.b : plan.c, peer = role === 'B' ? plan.c : plan.b, gateway = role === 'B' ? plan.ab : plan.ac;
  const init = linuxDevice(local) + `
hop=$(ip -4 route get ${gateway} from ${local} | head -1)
case " $hop " in *" via "*) echo 'A 必须是本链路可达的下一跳' >&2; exit 1;; esac
case " $hop " in *" dev $dev "*) ;; *) echo '下一跳与本机接口不匹配' >&2; exit 1;; esac`;
  const route = `${peer}/32 via ${gateway} dev "$dev" src ${local}`;
  const nmRoute = `"${peer}/32 ${gateway}"`;
  const networkConfig = `
uuid=
if command -v nmcli >/dev/null; then
  uuid=$(nmcli -t -f UUID,DEVICE connection show --active 2>/dev/null | awk -F: -v dev="$dev" '$2 == dev { print $1; exit }')
fi
if ! printf '%s' "$uuid" | grep -Eq '^[a-fA-F0-9-]{36}$'; then
  uuid=
  network=$(networkctl status --no-pager "$dev" 2>/dev/null | sed -n 's/^.*Network File: //p' | head -1)
  case "$network" in /*.network) ;; *) echo '此接口需要 NetworkManager 或 systemd-networkd 管理才能自动持久化路由' >&2; exit 1;; esac
  file="/etc/systemd/network/$(basename "$network").d/95-devkit-${peer}.conf"
  expected='[Route]
Destination=${peer}/32
Gateway=${gateway}
PreferredSource=${local}'
fi`;
  const cfg = checkedFile('保存主机路由', '', '"$file"', '"$expected"');
  return [
    { label:'保存主机路由', init: init + networkConfig,
      state: `if [ -n "$uuid" ]; then
  saved=$(nmcli -g ipv4.routes connection show uuid "$uuid")
  entries=$(printf '%s\\n' "$saved" | sed -E 's/\\{ ip = ([^,]+), nh = ([^ }]+) \\}/\\1 \\2/g' | tr ',;' '\\n' | sed 's/^ *//; s/ *$//')
  matches=$(printf '%s\\n' "$entries" | grep -F '${peer}/32' || true)
  if [ "$matches" = '${peer}/32 ${gateway}' ]; then echo present
  elif [ -n "$matches" ]; then echo '已有持久路由，请核对下一跳' >&2; exit 1
  else echo missing; fi
else ${cfg.state}; fi`,
      add: `if [ -n "$uuid" ]; then nmcli connection modify uuid "$uuid" +ipv4.routes ${nmRoute}; else ${cfg.add}; fi`,
      undo: `if [ -n "$uuid" ]; then nmcli connection modify uuid "$uuid" -ipv4.routes ${nmRoute}; else ${cfg.undo}; fi` },
    { label:'启用主机路由', init,
      state: `line=$(ip -4 route show exact ${peer}/32); if [ -z "$line" ]; then echo missing; else case " $line " in *" via ${gateway} dev $dev "*) echo present;; *) echo '现有主机路由与方案冲突' >&2; exit 1;; esac; fi`,
      add: 'ip -4 route add ' + route, undo: 'ip -4 route del ' + route },
  ];
}
function windowsOperations(plan, role) {
  const admin = `if (!([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '需要管理员权限' }`;
  function index(ip) { return admin + `\n$idx=(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '${ip}' -ErrorAction Stop).InterfaceIndex`; }
  if (role === 'A') return [...new Set([plan.ab, plan.ac])].map(ip => {
    const args = '-InterfaceIndex $idx -AddressFamily IPv4';
    return { label: ip + ' IPv4 转发', init:index(ip),
      state: `$a=(Get-NetIPInterface ${args} -PolicyStore ActiveStore).Forwarding; $p=(Get-NetIPInterface ${args} -PolicyStore PersistentStore).Forwarding; if ($a -ne $p) { throw '活动和持久转发状态不同，请核对接口配置' }; if ($a -eq 'Enabled') { 'present' } else { 'missing' }`,
      add:'Set-NetIPInterface ' + args + ' -Forwarding Enabled', undo:'Set-NetIPInterface ' + args + ' -Forwarding Disabled' };
  });
  const local = role === 'B' ? plan.b : plan.c, peer = role === 'B' ? plan.c : plan.b, via = role === 'B' ? plan.ab : plan.ac;
  const args = `-DestinationPrefix '${peer}/32' -InterfaceIndex $idx -NextHop '${via}'`;
  const init = index(local) + `\n$hop=Find-NetRoute -LocalIPAddress '${local}' -RemoteIPAddress '${via}' | Where-Object { $_.PSObject.Properties['NextHop'] }; if ($hop.NextHop -ne '0.0.0.0' -or $hop.InterfaceIndex -ne $idx) { throw 'A 必须是本链路可达的下一跳' }`;
  return [{ label:'持久主机路由', init,
    state: `$states = foreach ($store in 'ActiveStore','PersistentStore') { $r=@(Get-NetRoute -PolicyStore $store -AddressFamily IPv4 | Where-Object DestinationPrefix -eq '${peer}/32'); if (!$r.Count) { 'missing' } elseif ($r.Count -eq 1 -and $r[0].NextHop -eq '${via}' -and $r[0].InterfaceIndex -eq $idx) { 'present' } else { throw '现有主机路由与方案冲突' } }; if ($states[0] -ne $states[1]) { throw '活动和持久路由不一致' }; $states[0]`,
    add: 'New-NetRoute ' + args + ' | Out-Null', undo:'Remove-NetRoute ' + args + ' -Confirm:$false' }];
}

// The caller selects every management identity. All three preflights complete before the first write.
export async function applyRouting(input, profiles, lan, connect = routingManagementSession) {
  const plan = normalizeRouting(input), sessions = [], operations = [], added = [];
  let current = '', writing = false;
  try {
    for (const role of roles) {
      current = role;
      const id = role === plan.role ? undefined : profiles?.[role];
      if (role !== plan.role && !/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('请选择该设备已确认指纹的 SSH 档案。');
      const host = await connect(lan, id);
      sessions.push(host);
      for (const op of (host.platform === 'win32' ? windowsOperations : linuxOperations)(plan, role)) {
        const run = key => host.run(op.init + '\n' + op[key]);
        current = role + ' · ' + op.label;
        const state = await run('state');
        if (!['missing','present'].includes(state)) throw new Error('无法确认当前配置。');
        operations.push({ role, label:current, run });
      }
    }
    for (const op of operations) {
      current = op.label;
      const state = await op.run('state');
      if (state === 'present') continue;
      if (state !== 'missing') throw new Error('配置状态发生变化。');
      writing = true;
      await op.run('add');
      writing = false;
      added.push(op);
      if (await op.run('state') !== 'present') throw new Error('应用后未读到预期配置。');
    }
    const checks = await Promise.all(['B', 'C'].map(async (role, i) => {
      const host = sessions[i + 1], peer = role === 'B' ? plan.c : plan.b, local = role === 'B' ? plan.b : plan.c;
      const cmd = host.platform === 'win32' ? `$ping=New-Object System.Net.NetworkInformation.Ping; try { if ($ping.Send('${peer}',2000).Status -ne 'Success') { throw 'ICMP' } } finally { $ping.Dispose() }` : `ping -I ${local} -c 1 -W 2 ${peer} >/dev/null`;
      try { await host.run(cmd); return role + ' → ' + peer + '：ICMP 已收到应答'; }
      catch { return role + ' → ' + peer + '：未确认 ICMP，请用实际服务验证并检查防火墙'; }
    }));
    return [added.length ? '三台设备的路由配置已应用并复核。' : '三台设备的持久配置已就绪。', ...checks].join('\n');

  } catch (error) {
    const failures = [];
    for (const op of added.reverse()) {
      try { await op.run('undo'); if (await op.run('state') !== 'missing') throw new Error(); } catch { failures.push(op.label); }
    }
    throw new Error(current + '：' + error.message + (writing ? '。写入返回失败，请复核此项的最终状态' : '') + (failures.length ? '。撤回未确认：' + failures.join('、') : added.length ? '。已撤回本次已确认的更改。' : ''));
  } finally { for (const host of sessions) host.close(); }
}
