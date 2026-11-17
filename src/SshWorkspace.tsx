import { useCallback, useState } from 'react';
import { ArrowLeft, FileText, Plus, RefreshCw } from 'lucide-react';
import ConfigFilesDialog from './ConfigFilesDialog';
import type { ConfigRequest } from './ConfigFilesDialog';
import { useConfirmation } from './Confirmation';
import { Modal } from './project-components';
import { newProjectId } from './project-api';
import { sshRequest } from './ssh-api';
import type { ManagedModule, SshHost, SshTarget } from './ssh-api';

const newTarget = (): SshTarget => ({ id: newProjectId(), name: '', path: '', executable: '', args: [], files: [], prefix: '' });
const lines = (value: string) => value.split(/\r?\n/).filter(Boolean);
const base = (path: string) => path.split(/[\\/]/).pop() || path;

export default function SshWorkspace({ host, module, back, close }: {
  host: SshHost;
  module: ManagedModule;
  back: () => void;
  close: () => void;
}) {
  const key = 'devkit:ssh-targets:' + JSON.stringify([host.platform, host.address, host.port, host.user, module]);
  const [targets, setTargets] = useState<SshTarget[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  });
  const [status, setStatus] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ initial: SshTarget; draft: SshTarget } | null>(null);
  const [config, setConfig] = useState<SshTarget | null>(null);
  const [log, setLog] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const confirm = useConfirmation();
  const jar = module === 'jar';
  const persist = (items: SshTarget[]) => {
    localStorage.setItem(key, JSON.stringify(items));
    setTargets(items);
  };
  const requestConfig = useCallback<ConfigRequest>((action, payload) => sshRequest({ host, module, target: config ?? undefined, action, payload }), [host, module, config]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setError('');
    setFeedback('');
    setBusy(true);
    try { await operation(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  function edit(item = newTarget()) {
    setError('');
    setEditing({ initial: item, draft: item });
  }
  function update(values: Partial<SshTarget>) {
    setEditing(current => current && { ...current, draft: { ...current.draft, ...values } });
  }
  async function register(draft: SshTarget) {
    const path = draft.path.trim();
    const target = {
      ...draft, name: draft.name.trim() || base(path), path, executable: draft.executable.trim(), args: lines(draft.args.join('\n')),
      files: draft.files.map(file => file.trim()).filter(Boolean), prefix: draft.prefix.trim(),
    };
    if (targets.some(item => item.id !== target.id && (host.platform === 'win32'
      ? item.path.replaceAll('/', '\\').toLowerCase() === path.replaceAll('/', '\\').toLowerCase()
      : item.path === path))) throw new Error('此路径已登记。');
    await sshRequest({ host, module, action: 'validate', target });
    persist(targets.some(item => item.id === target.id)
      ? targets.map(item => item.id === target.id ? target : item)
      : [...targets, target]);
    setStatus(current => ({ ...current, [target.id]: '' }));
    setEditing(null);
    setFeedback('已验证目标文件并登记。');
  }
  async function action(target: SshTarget, action: string) {
    if (['stop', 'restart', 'reload'].includes(action) && !await confirm({
      title: `对 ${host.name} 上的 ${target.name} 执行${action === 'stop' ? '停止' : action === 'restart' ? '重启' : '重载'}？`,
      detail: target.path,
      confirm: action === 'stop' ? '停止 JAR' : action === 'restart' ? '重启 JAR' : '重载 Nginx',
    })) return;
    await run(async () => {
      const output = await sshRequest<string>({ host, module, action, target });
      if (action === 'log') setLog({ name: target.name, text: output });
      else if (jar) setStatus(current => ({ ...current, [target.id]: output === 'stopped' ? '未运行' : output }));
      else setFeedback(output);
    });
  }
  async function remove(target: SshTarget) {
    if (!await confirm({ title: `移除 ${target.name}？`, detail: '只移除本机登记。目标主机上的文件和进程将保留。', confirm: '移除登记' })) return;
    await run(async () => persist(targets.filter(item => item.id !== target.id)));
  }

  const draft = editing?.draft;
  return <>
    <Modal title={`SSH · ${host.name} · ${jar ? 'JAR 管理' : 'Nginx 配置'}`} closeLabel="关闭 SSH 工作台" close={close} busy={busy} wide feedback={feedback}>
      <div className="lan-hosts">
        <p>{host.user}@{host.address}:{host.port} · {host.platform === 'win32' ? 'Windows' : 'Linux'}。路径、运行和文件操作均使用该 SSH 账号的权限。</p>
        <div className="pc-actions">
          <button type="button" className="text-button" onClick={back}><ArrowLeft size={15} />主机列表</button>
          <button type="button" className="run-button" onClick={() => edit()}><Plus size={15} />{jar ? '添加 JAR' : '添加 Nginx 实例'}</button>
        </div>
        {error && !editing && <p className="pc-error" role="alert">{error}</p>}
        {!targets.length && <p>添加目标电脑上已有的{jar ? ' JAR 文件' : ' Nginx 主配置'}，填写绝对路径。</p>}
        <ul className="ssh-target-list">{targets.map(target => <li key={target.id}>
          <header><strong>{target.name}</strong>{jar && <span role="status">{status[target.id] || '状态待刷新'}</span>}</header>
          <small>{target.path}</small>
          <div className="pc-actions">
            {jar ? <>
              <button type="button" className="secondary-button" onClick={() => void action(target, 'start')}>启动</button>
              <button type="button" className="text-button" onClick={() => void action(target, 'stop')}>停止</button>
              <button type="button" className="text-button" onClick={() => void action(target, 'restart')}>重启</button>
              <button type="button" className="text-button" onClick={() => void action(target, 'status')}><RefreshCw size={14} />状态</button>
              <button type="button" className="text-button" onClick={() => void action(target, 'log')}>日志</button>
            </> : <>
              <button type="button" className="secondary-button" onClick={() => void action(target, 'test')}>检查配置</button>
              <button type="button" className="text-button" onClick={() => void action(target, 'reload')}>重载</button>
            </>}
            <button type="button" className="text-button" onClick={() => setConfig(target)}><FileText size={14} />配置文件</button>
            <button type="button" className="text-button" onClick={() => edit(target)}>设置</button>
            <button type="button" className="text-button" onClick={() => void remove(target)}>移除</button>
          </div>
        </li>)}</ul>
        {log && <section className="ssh-log"><strong>{log.name} · 启动日志</strong><button type="button" className="text-button" onClick={() => setLog(null)}>关闭日志</button><pre>{log.text || '暂无日志。'}</pre></section>}
      </div>
    </Modal>
    {editing && draft && <Modal title={targets.some(item => item.id === draft.id) ? '编辑远程登记' : jar ? '添加远程 JAR' : '添加远程 Nginx 实例'} close={() => setEditing(null)} closeLabel="关闭远程登记" busy={busy} draft={draft}>
      <form onSubmit={event => { event.preventDefault(); void run(() => register(draft)); }}>
        <label>显示名称（可选）<input maxLength={120} value={draft.name} onChange={event => update({ name: event.target.value })} /></label>
        <label>{jar ? '目标主机 JAR 绝对路径' : '目标主机 Nginx 主配置绝对路径'}<input required maxLength={4096} value={draft.path} onChange={event => update({ path: event.target.value })} /></label>
        <label>{jar ? 'Java 程序绝对路径（可选）' : 'Nginx 程序绝对路径（可选）'}<input maxLength={4096} value={draft.executable} onChange={event => update({ executable: event.target.value })} /></label>
        {jar ? <label>应用参数（每行一个）<textarea rows={3} value={draft.args.join('\n')} onChange={event => update({ args: event.target.value.split('\n') })} /></label>
          : <>
            <label>运行目录绝对路径（可选）<input maxLength={4096} value={draft.prefix} onChange={event => update({ prefix: event.target.value })} /></label>
            <label>附属配置绝对路径（每行一个）<textarea rows={3} value={draft.files.join('\n')} onChange={event => update({ files: event.target.value.split('\n') })} /></label>
          </>}
        {error && <p className="pc-error" role="alert">{error}</p>}
        <div className="pc-actions"><button type="submit" className="run-button">验证并保存</button></div>
      </form>
    </Modal>}
    {config && <ConfigFilesDialog item={config} kind={module} request={requestConfig} editable close={() => setConfig(null)} />}
  </>;
}
