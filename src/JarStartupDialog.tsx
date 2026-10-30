import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { jarRequest } from './jar-api';
import type { JarInstance, JarStartup } from './jar-api';
import { MotionButton } from './Motion';

export default function JarStartupDialog({ item, platform, close }: { item: JarInstance; platform: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), title = useId();
  const [state, setState] = useState<JarStartup | null>(null), [mode, setMode] = useState<'login' | 'boot'>('login'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function task(action: () => Promise<JarStartup>) {
    setBusy(true); setError(''); try { const next = await action(); setState(next); setMode(next.mode || 'login'); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { const previous = document.activeElement; ref.current?.showModal(); void task(() => jarRequest<JarStartup>('startup-get', { id: item.id })); return () => { ref.current?.close(); if (previous instanceof HTMLElement) previous.focus(); }; }, []);
  return <dialog ref={ref} className="jar-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!busy) close(); }}><header><h2 id={title}>{item.name} · 系统自启</h2><button className="icon-button" disabled={busy} aria-label="关闭自启设置" onClick={close}><X size={18} /></button></header><div className="jar-startup-content">
    <p className="jar-help">使用当前用户身份启动独立守护，无需先打开 DevKit。应用使用已保存的环境档案；安装自启不会立即启动应用。</p>
    <p className="jar-notice">当前状态：{state ? state.enabled ? '已启用' : '未启用' : '正在检查…'}{state?.target && <small className="jar-full-path">{state.target}</small>}</p>
    <label>触发方式<select value={mode} disabled={busy} onChange={event => setMode(event.target.value as 'login' | 'boot')}><option value="login">当前用户登录后启动</option><option value="boot">系统开机启动（无需登录）</option></select></label>
    <p className="jar-help">{platform === 'win32' ? mode === 'boot' ? '使用 Windows 任务计划的开机触发与当前用户 S4U。注册可能需要管理员权限，且无法访问需要交互登录凭据的网络资源。' : '使用 Windows 任务计划，当前用户登录后启动。' : mode === 'boot' ? '启用当前用户 systemd 服务和 linger：用户服务将在开机启动，并可在注销后继续运行。系统可能要求授权。关闭此 JAR 自启不会关闭其他服务使用的 linger。' : '启用 systemd 用户服务，随图形会话登录启动。桌面环境需支持 graphical-session.target；服务器或不支持的桌面请选择开机模式。'}</p>
    {(error || state?.error) && <p className="jar-error" role="alert">{error || state?.error}</p>}
    <p className="jar-help">移动或卸载 DevKit 前先关闭自启；更换安装路径后重新启用。关闭自启只移除触发配置，正在运行的 JAR 仍需在列表停止。</p>
    <footer><button className="text-button" disabled={busy} onClick={close}>关闭</button><MotionButton busy={busy} className="secondary-button" disabled={busy || !state} onClick={() => void task(() => jarRequest<JarStartup>('startup-remove', { id: item.id }))}>关闭自启</MotionButton><MotionButton busy={busy} className="run-button" disabled={busy || !state} onClick={() => void task(() => jarRequest<JarStartup>('startup-install', { id: item.id, mode }))}>启用{mode === 'boot' ? '开机' : '登录'}自启</MotionButton></footer>
  </div></dialog>;
}
