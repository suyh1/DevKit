import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Search, Star, ShieldCheck, PanelLeftClose, PanelLeftOpen, Code2, ChevronDown, LayoutGrid, Clock3, Settings2, Plus, X, Save, FolderOpen, Undo2, Check, CopyPlus, LoaderCircle } from 'lucide-react';
import { tools } from './tools';
import type { Options, ToolId } from './tools';
import { isColorTool } from './colors';
import ColorWorkbench, { savedColors } from './ColorWorkbench';
import ToolWorkspace from './ToolWorkspace';
import GeoWorkbench from './GeoWorkbench';
import { mergeGeoOutput } from './geography';
import Overview from './Overview';
import Settings from './Settings';
import ProjectCenter from './ProjectCenter';
import CommandPalette from './CommandPalette';
import { toolIcons, categoryMeta, categoryOrder } from './ui';
import { createTask, defaultPreferences, editTask, importWorkspace, normalizeFavorites, MAX_TASKS, validatePreferences, workspaceSnapshot } from './workbench';
import type { Preferences, Task } from './workbench';
import { saveText } from './files';
import packageInfo from '../package.json';

type Page = 'home' | 'favorites' | 'recent' | 'settings' | 'task' | 'projects';
type Job = { worker: Worker; timeout: ReturnType<typeof setTimeout> };
function readPreference(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function initialPreferences(): Preferences {
  const saved = readPreference('devkit:preferences');
  return saved ? validatePreferences(saved) : { ...defaultPreferences, theme: readPreference('devkit:dark') === true ? 'dark' : 'system' };
}

export default function App() {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [tasks, setTasks] = useState<Task[]>(() => preferences.startup !== 'home' ? [createTask(preferences.startup, preferences.indent)] : []);
  const [activeId, setActiveId] = useState<string | null>(tasks[0]?.id ?? null);
  const [page, setPage] = useState<Page>(tasks.length ? 'task' : 'home');
  const [favorites, setFavorites] = useState<ToolId[]>(() => { const saved = readPreference('devkit:favorites'); return Array.isArray(saved) ? normalizeFavorites(saved) : ['json', 'timestamp']; });
  const [recent, setRecent] = useState<ToolId[]>([]), [folded, setFolded] = useState<string[]>(() => categoryOrder.filter(name => name !== (tools.find(tool => tool.id === preferences.startup)?.category ?? categoryOrder[0])));
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [searchOpen, setSearchOpen] = useState(false), [saveOpen, setSaveOpen] = useState(false), [includeSensitive, setIncludeSensitive] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [sharedColor, setSharedColor] = useState('#147D64');
  const [colorFavorites, setColorFavorites] = useState(savedColors);
  const jobs = useRef(new Map<string, Job>()), execute = useRef<() => void>(() => {});
  const tabs = useRef<HTMLDivElement>(null), workspaceFile = useRef<HTMLInputElement>(null), saveDialog = useRef<HTMLDialogElement>(null);
  const tasksRef = useRef(tasks); tasksRef.current = tasks;
  const activeTask = tasks.find(task => task.id === activeId);
  const currentTool = tools.find(tool => tool.id === activeTask?.toolId);
  function notice(message: string, undo?: () => void) { setToast({ message, undo }); }
  function patch(id: string, values: Partial<Task>) { setTasks(current => current.map(task => task.id === id ? { ...task, ...values } : task)); }
  function edit(id: string, values: Partial<Task>) { setTasks(current => current.map(task => task.id === id ? editTask(task, values) : task)); }
  function focusTask(id: string) { setActiveId(id); setPage('task'); if (window.matchMedia('(max-width: 760px)').matches) setCollapsed(true); }
  function openTool(toolId: ToolId, fresh = false, input?: string, options?: Options) {
    setFolded(current => current.filter(category => category !== tools.find(tool => tool.id === toolId)?.category));
    const existing = !fresh && tasksRef.current.find(task => task.toolId === toolId);
    if (existing) focusTask(existing.id);
    else {
      if (tasksRef.current.length >= MAX_TASKS) { notice('最多打开 12 个任务，请先关闭不需要的任务。'); return; }
      const task = createTask(toolId, preferences.indent, input);
      if (toolId === 'yaml' && input !== undefined) task.options.mode = 'json-yaml';
      if (options) task.options = { ...task.options, ...options };
      setTasks(current => [...current, task]); focusTask(task.id);
    }
    setRecent(current => [toolId, ...current.filter(id => id !== toolId)].slice(0, tools.length));
  }
  function stop(id: string) {
    const job = jobs.current.get(id);
    if (job) { job.worker.terminate(); clearTimeout(job.timeout); jobs.current.delete(id); }
  }
  function cancel(id: string) { stop(id); patch(id, { status: 'cancelled', error: '' }); }
  function run(id: string) {
    const task = tasksRef.current.find(item => item.id === id);
    if (!task || jobs.current.has(id) || isColorTool(task.toolId)) return;
    patch(id, { status: 'running', error: '' });
    const started = performance.now();
    const fail = (error: string) => { stop(id); patch(id, { status: 'error', error }); };
    try {
      const worker = new Worker(new URL('./tool.worker.ts', import.meta.url), { type: 'module' });
      const timeout = setTimeout(() => fail('处理超时，任务已停止。请缩小输入或简化表达式后重试。'), task.toolId === 'regex' ? 3000 : 10_000);
      jobs.current.set(id, { worker, timeout });
      worker.onmessage = event => {
        if (jobs.current.get(id)?.worker !== worker) return;
        stop(id);
        if (event.data.error) patch(id, { status: 'error', error: String(event.data.error) });
        else patch(id, { status: 'success', output: task.toolId === 'geo-coordinates' ? mergeGeoOutput(task.elapsed === null ? '' : task.output, String(event.data.output)) : String(event.data.output ?? ''), error: '', elapsed: Math.round(performance.now() - started) });
      };
      worker.onerror = () => fail('执行模块加载失败，请重试；若问题持续，请重新打开应用。');
      worker.onmessageerror = () => fail('无法读取处理结果，请重试。');
      worker.postMessage({ id: task.toolId, input: task.input, options: task.options });
    } catch (error) { fail(`无法启动处理任务：${String(error)}`); }
  }
  execute.current = () => { if (page === 'task' && activeId && !searchOpen && !saveOpen) run(activeId); };
  function closeTask(id: string) {
    const index = tasks.findIndex(task => task.id === id), task = tasks[index];
    if (!task) return;
    stop(id); setTasks(current => current.filter(item => item.id !== id));
    if (activeId === id) { const next = tasks[index + 1] || tasks[index - 1]; setActiveId(next?.id ?? null); if (!next) setPage('home'); }
    notice(`已关闭 ${tools.find(tool => tool.id === task.toolId)!.name}${isColorTool(task.toolId) ? '，图片与颜色面板临时状态已释放' : ''}`, isColorTool(task.toolId) ? undefined : () => {
      if (tasksRef.current.length >= MAX_TASKS) { notice('任务已满，暂时无法恢复。'); return; }
      setTasks(current => [...current.slice(0, index), { ...task, status: task.status === 'running' ? 'cancelled' : task.status }, ...current.slice(index)]); focusTask(id);
    });
  }
  function navigate(next: Page) { setPage(next); if (window.matchMedia('(max-width: 760px)').matches) setCollapsed(true); }
  function toggleFavorite(id: ToolId) { setFavorites(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); }
  async function restoreWorkspace(file?: File) {
    if (!file) return;
    try {
      if (file.size > 24_000_000) throw new Error('工作区文件超过大小限制。');
      const restored = importWorkspace(await file.text());
      if (tasksRef.current.length + restored.tasks.length > MAX_TASKS) throw new Error('恢复后超过 12 个任务，请先关闭部分任务。');
      if (!restored.tasks.length) { notice('工作区没有可恢复的文本任务。'); return; }
      setTasks(current => [...current, ...restored.tasks]); focusTask(restored.tasks[restored.active].id);
      setRecent(current => [...new Set([...restored.tasks.map(task => task.toolId), ...current])]);
      notice(`已恢复 ${restored.tasks.length} 个任务。导入结果标记为待更新，请重新处理。`);
    } catch (error) { notice(`恢复失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = preferences.theme === 'system' ? media.matches ? 'dark' : 'light' : preferences.theme; };
    update(); media.addEventListener('change', update);
    try { localStorage.setItem('devkit:preferences', JSON.stringify(preferences)); } catch { notice('偏好设置无法持久保存；本次会话仍然生效。'); }
    return () => media.removeEventListener('change', update);
  }, [preferences]);
  useEffect(() => { try { localStorage.setItem('devkit:favorites', JSON.stringify(favorites)); } catch { notice('收藏无法持久保存，请导出设置备份。'); } }, [favorites]);
  useEffect(() => { try { localStorage.setItem('devkit:colors', JSON.stringify(colorFavorites)); } catch { notice('收藏色无法保存，请导出备份。'); } }, [colorFavorites]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!saveDialog.current?.open) setSearchOpen(current => !current); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); execute.current(); }
      if (event.key === '/' && !(event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)))) {
        const input = document.querySelector<HTMLInputElement>('.overview-workspace:not([hidden]) input');
        if (input) { event.preventDefault(); input.focus(); }
      }
    };
    const currentJobs = jobs.current;
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); currentJobs.forEach(job => { job.worker.terminate(); clearTimeout(job.timeout); }); currentJobs.clear(); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => { setNarrow(media.matches); setCollapsed(media.matches); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!narrow || collapsed) return;
    const previous = document.activeElement;
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    const controls = () => [...(sidebar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])].filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setCollapsed(true); }
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [narrow, collapsed]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), toast.undo ? 12_000 : 6000); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { if (saveOpen) saveDialog.current?.showModal(); else saveDialog.current?.close(); }, [saveOpen]);
  useEffect(() => { tabs.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeId, page]);

  return <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`} data-density={preferences.density} style={{ '--code-size': `${preferences.fontSize}px` } as CSSProperties}>
{!collapsed && <button className="sidebar-backdrop" tabIndex={-1} aria-label="关闭工具导航" onClick={() => setCollapsed(true)} />}
    <aside className="sidebar" role={narrow && !collapsed ? 'dialog' : undefined} aria-modal={narrow && !collapsed ? true : undefined} aria-label="工具导航与工作台"><button className="brand" onClick={() => navigate('home')} title="工作台总览"><span className="brand-mark"><Code2 size={23} /></span><span className="brand-word"><strong>DevKit<span>.</span></strong><small>本地开发工作台</small></span><span className="brand-version">{packageInfo.version}</span></button>
      <button className="sidebar-search" aria-label="打开工具搜索" onClick={() => setSearchOpen(true)}><Search size={15} /><span>搜索工具或用途</span><kbd>Ctrl K</kbd></button>
      <div className="sidebar-workspace">{([{ id: 'home', label: '工作台', Icon: LayoutGrid, count: tools.length }, { id: 'favorites', label: '我的收藏', Icon: Star, count: favorites.length }, { id: 'recent', label: '最近使用', Icon: Clock3, count: recent.length }] as const).map(item => <button className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} title={item.label} key={item.id} onClick={() => navigate(item.id)}><item.Icon size={17} /><span>{item.label}</span><small>{item.count}</small></button>)}</div>
      <button className={`nav-item ${page === 'projects' ? 'active' : ''}`} aria-current={page === 'projects' ? 'page' : undefined} title="项目中心" onClick={() => navigate('projects')}><FolderOpen size={17} /><span>项目中心</span><small>共享</small></button>
      <div className="nav-caption"><span>按任务分类</span><small>{categoryOrder.length} 个分组</small></div><nav aria-label="工具导航">{categoryOrder.map(category => <div className="nav-group" key={category}><button className="nav-group-heading" aria-expanded={!folded.includes(category)} onClick={() => setFolded(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category])}><span>{category}</span><ChevronDown size={12} className={folded.includes(category) ? 'folded' : ''} /></button>{(!folded.includes(category) || collapsed) && tools.filter(tool => tool.category === category).map(tool => { const Icon = toolIcons[tool.id], selected = page === 'task' && activeTask?.toolId === tool.id, count = tasks.filter(task => task.toolId === tool.id).length; return <button className={`nav-item ${selected ? 'active' : ''}`} aria-current={selected ? 'page' : undefined} title={tool.name} key={tool.id} onClick={() => openTool(tool.id)}><Icon size={16} /><span>{tool.name}</span>{count > 0 && <small>{count}</small>}</button>; })}</div>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} title="设置" onClick={() => navigate('settings')}><Settings2 size={17} /><span>偏好设置</span><small>v{packageInfo.version}</small></button><div className="local-badge"><ShieldCheck size={15} /><div><strong>离线运行 · 数据留在本机</strong><small>无需登录，无遥测</small></div></div></div>
    </aside>
    <main inert={narrow && !collapsed}><header className="topbar floating-navbar">
      <div className="breadcrumb"><button className="icon-button" aria-label={collapsed ? '展开导航' : '收起导航'} onClick={() => setCollapsed(current => !current)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><button onClick={() => navigate('home')}>工作台</button><span>/</span><strong>{page === 'projects' ? '项目中心' : page === 'task' ? currentTool?.category : page === 'settings' ? '偏好设置' : page === 'favorites' ? '我的收藏' : page === 'recent' ? '最近使用' : '总览'}</strong></div>
      <nav className="floating-nav-links" aria-label="主导航">{([{ id: 'home', label: '工作空间', Icon: LayoutGrid }, { id: 'projects', label: '项目中心', Icon: FolderOpen }, { id: 'favorites', label: '收藏', Icon: Star }] as const).map(item => <button key={item.id} aria-label={item.label} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.Icon size={14} /><span>{item.label}</span></button>)}</nav>
      <div className="top-actions"><span className="offline-status"><span />本地处理</span><button className="text-button" onClick={() => workspaceFile.current?.click()} title="恢复工作区"><FolderOpen size={15} /><span>恢复</span></button><button className="text-button" disabled={!tasks.some(task => !isColorTool(task.toolId))} onClick={() => { setIncludeSensitive(false); setSaveOpen(true); }} title="保存工作区"><Save size={15} /><span>保存工作区</span></button><button className="icon-button navbar-search" aria-label="搜索全部工具" onClick={() => setSearchOpen(true)}><Search size={17} /></button></div>
    </header>
      {tasks.length > 0 && <div className="task-strip"><button className={`home-tab ${page !== 'task' ? 'selected' : ''}`} onClick={() => navigate('home')} title="工作台总览" aria-label="工作台总览"><LayoutGrid size={16} /></button><div className="task-tabs" role="tablist" aria-label="已打开的任务" ref={tabs}>{tasks.map((task, index) => { const tool = tools.find(item => item.id === task.toolId)!, Icon = toolIcons[task.toolId], selected = page === 'task' && task.id === activeId; const sequence = tasks.slice(0, index + 1).filter(item => item.toolId === task.toolId).length; return <div className={`task-tab ${selected ? 'selected' : ''}`} key={task.id}><button role="tab" id={`tab-${task.id}`} aria-controls={`task-${task.id}`} aria-selected={selected} tabIndex={selected || page !== 'task' && index === 0 ? 0 : -1} onClick={() => focusTask(task.id)} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % tasks.length; else if (event.key === 'ArrowLeft') next = (index + tasks.length - 1) % tasks.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = tasks.length - 1; else if (event.key === 'Delete') { event.preventDefault(); closeTask(task.id); return; } else return; event.preventDefault(); focusTask(tasks[next].id); document.getElementById(`tab-${tasks[next].id}`)?.focus(); }}>{task.status === 'running' ? <LoaderCircle size={14} className="spin" /> : <Icon size={14} />}<span>{tool.name}{sequence > 1 ? ` ${sequence}` : ''}</span>{['stale', 'idle'].includes(task.status) && task.input && <i title="未更新的输入" />}</button><button className="tab-close" tabIndex={selected ? 0 : -1} aria-label={`关闭${tool.name}任务 ${sequence}`} onClick={() => closeTask(task.id)}><X size={12} /></button></div>; })}</div><button className="icon-button" aria-label="新建任务" onClick={() => setSearchOpen(true)}><Plus size={16} /></button></div>}
      <div className="workspace-stage">
        <div hidden={page !== 'projects'} className="workspace project-workspace"><ProjectCenter /></div>
        <div hidden={!['home', 'favorites', 'recent'].includes(page)} className="workspace overview-workspace"><Overview onDetect={(id, text, options) => openTool(id, true, text, options)} key={page === 'task' || page === 'settings' ? 'home' : page} mode={page === 'favorites' ? 'favorites' : page === 'recent' ? 'recent' : 'home'} onChoose={openTool} favorites={favorites} onFavorite={toggleFavorite} recent={recent} tasks={tasks} onResume={focusTask} library={preferences.library} onLibrary={library => setPreferences(current => ({ ...current, library }))} /></div>
        {page === 'settings' && <div className="workspace"><Settings preferences={preferences} onChange={setPreferences} favorites={favorites} onFavorites={setFavorites} onNotice={notice} /></div>}
{tasks.map(task => { const tool = tools.find(item => item.id === task.toolId)!, Icon = toolIcons[task.toolId]; return <div key={task.id} id={`task-${task.id}`} role="tabpanel" aria-labelledby={`tab-${task.id}`} hidden={page !== 'task' || task.id !== activeId} className={`workspace task-pane ${isColorTool(task.toolId) ? 'color-workspace-shell' : 'text-workspace-shell'}`}><div className="page-heading"><span className={`tool-icon page-icon category-${categoryMeta[tool.category].key}`}><Icon size={23} /></span><div className="page-title"><div className="eyebrow">{tool.english}</div><h1>{tool.name}</h1></div><button className="secondary-button" title="新建同类独立任务" onClick={() => openTool(task.toolId, true)}><CopyPlus size={14} /><span>新任务</span></button><button className={`icon-button ${favorites.includes(task.toolId) ? 'is-favorite' : ''}`} title="收藏工具" aria-label={`${favorites.includes(task.toolId) ? '取消收藏' : '收藏'}${tool.name}`} aria-pressed={favorites.includes(task.toolId)} onClick={() => toggleFavorite(task.toolId)}><Star size={17} fill={favorites.includes(task.toolId) ? 'currentColor' : 'none'} /></button></div>{isColorTool(task.toolId) ? <ColorWorkbench mode={task.toolId} primary={sharedColor} onPrimary={setSharedColor} favorites={colorFavorites} onFavorites={setColorFavorites} /> : task.toolId === 'geo-coordinates' ? <GeoWorkbench task={task} onEdit={values => edit(task.id, values)} onRun={() => run(task.id)} onCancel={() => cancel(task.id)} onNotice={notice} /> : <ToolWorkspace task={task} preferences={preferences} onEdit={values => edit(task.id, values)} onRun={() => run(task.id)} onCancel={() => cancel(task.id)} onNotice={notice} onSend={(toolId, text) => openTool(toolId, true, text)} />}</div>; })}
      </div>
      <footer className="app-statusbar"><span><ShieldCheck size={12} />输入与结果仅保留在内存，主动保存除外</span><span>{tasks.length} / {MAX_TASKS} 个任务 · DevKit {packageInfo.version}</span></footer>
    </main>
    <input ref={workspaceFile} type="file" className="sr-only" aria-label="恢复工作区文件" accept=".json" onChange={event => { void restoreWorkspace(event.target.files?.[0]); event.target.value = ''; }} />
    <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} onChoose={openTool} favorites={favorites} recent={recent} />
    <dialog className="save-dialog" ref={saveDialog} aria-labelledby="save-title" onCancel={() => setSaveOpen(false)}><div className="dialog-heading"><h2 id="save-title">保存当前工作区</h2><button className="icon-button" aria-label="关闭保存窗口" onClick={() => setSaveOpen(false)}><X size={17} /></button></div><p>文件将包含文本任务的输入、参数和结果。请妥善保管，文件未加密。</p><div className="snapshot-summary"><strong>{tasks.filter(task => !isColorTool(task.toolId) && (includeSensitive || !['jwt', 'password', 'hmac'].includes(task.toolId))).length}</strong> 个文本任务将被保存</div><label className="sensitive-toggle"><input type="checkbox" checked={includeSensitive} onChange={event => setIncludeSensitive(event.target.checked)} />同时包含密码、JWT 和 HMAC 任务（可能含敏感信息）</label><p className="preview-note">颜色任务、图片和正在执行的任务状态不保存。恢复后请重新运行验证结果。</p><button className="run-button" onClick={async () => { try { const snapshot = workspaceSnapshot(tasksRef.current, activeId, includeSensitive); setSaveOpen(false); notice(await saveText(snapshot, 'devkit-workspace.json')); } catch (error) { notice(`保存失败：${String(error)}`); } }}><Save size={15} />选择位置并保存</button></dialog>
    {toast && <div className="app-toast" role="status"><Check size={16} /><span>{toast.message}</span>{toast.undo && <button onClick={() => { toast.undo?.(); setToast(null); }}><Undo2 size={14} />撤销</button>}<button aria-label="关闭通知" onClick={() => setToast(null)}><X size={14} /></button></div>}
  </div>;
}




