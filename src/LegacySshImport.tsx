import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { lanRequest } from './lan-api';
import type { HostGroup, LanHost, ManagedModule } from './lan-api';

type PreviousTarget = { id: string; name: string; path: string; executable: string; args: string[]; files: string[]; prefix: string };
type Import = { host: LanHost; storageKey: string; targets: PreviousTarget[] };
const prefix = 'devkit:ssh-targets:';

function readImports(hosts: LanHost[], module: ManagedModule): Import[] {
  const entries: Import[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(prefix)) continue;
    try {
      const [platform, address, port, user, type] = JSON.parse(storageKey.slice(prefix.length));
      if (type !== module) continue;
      const host = hosts.find(item => item.mode === 'ssh' && item.platform === platform && item.address === address.toLowerCase() && item.port === port && item.user === user);
      const targets: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (host && Array.isArray(targets) && targets.length) entries.push({ host, storageKey, targets });
    } catch { /* Leave unrecognized records available to the previous version. */ }
  }
  return entries;
}

export default function LegacySshImport({ module, groups, disabled, refresh }: { module: ManagedModule; groups?: HostGroup[]; disabled: boolean; refresh: () => void }) {
  const [entries, setEntries] = useState<Import[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    if (!window.devkitDesktop?.lanHosts) return;
    let active = true;
    void lanRequest<LanHost[]>('list').then(hosts => { if (active) setEntries(readImports(hosts, module)); }).catch(() => {});
    return () => { active = false; };
  }, [module, groups]);
  if (!entries.length && !message) return null;
  async function migrate() {
    setBusy(true); setMessage('');
    let imported = 0;
    const failures = [];
    try {
      for (const { host, storageKey, targets } of entries) {
        const group = groups?.find(item => item.id === host.id);
        if (!group?.edit) { failures.push(`${host.name}：请先启用此栏目并测试 SSH 连接。`); continue; }
        const remaining = [];
        for (const target of targets) {
          try { await lanRequest('legacy-import', { id: host.id, module, target }); imported++; }
          catch (error) { remaining.push(target); failures.push(`${target.name}：${(error as Error).message}`); }
        }
        localStorage.setItem(storageKey, JSON.stringify(remaining));
      }
    } catch (error) { failures.push((error as Error).message); }
    finally {
      setBusy(false);
      setMessage([imported ? `已导入 ${imported} 条旧版 SSH 登记。` : '', ...failures].filter(Boolean).join(' '));
      refresh();
    }
  }
  return <div className="lan-legacy-import">{!!entries.length && <button type="button" className="secondary-button" disabled={disabled || busy} onClick={() => void migrate()}><Download size={15} />{busy ? '正在导入…' : '导入旧版 SSH 登记'}</button>}{message && <p className="lan-note" role="status">{message}</p>}</div>;
}
