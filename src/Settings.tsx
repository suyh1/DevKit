import { useRef } from 'react';
import { Monitor, Download, Upload, RotateCcw, ShieldCheck, Keyboard } from 'lucide-react';
import { tools } from './tools';
import { defaultPreferences, validatePreferences, normalizeFavorites } from './workbench';
import type { Preferences } from './workbench';
import type { ToolId } from './tools';
import { saveText } from './files';
import { WindowCloseSetting } from './DesktopClose';

export default function Settings({ preferences, onChange, favorites, onFavorites, onNotice }: { preferences: Preferences; onChange: (value: Preferences) => void; favorites: ToolId[]; onFavorites: (value: ToolId[]) => void; onNotice: (message: string, undo?: () => void) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Preferences>) => onChange({ ...preferences, ...patch });
  async function exportSettings() {
    try { onNotice(await saveText(JSON.stringify({ format: 'devkit-preferences', version: 1, preferences, favorites }, null, 2), 'devkit-settings.json')); }
    catch (error) { onNotice(`导出失败：${String(error)}`); }
  }
  async function importSettings(source?: File) {
    if (!source) return;
    try {
      if (source.size > 100_000) throw new Error('设置文件过大');
      const data = JSON.parse(await source.text());
      if (data?.format !== 'devkit-preferences' || data.version !== 1 || !data.preferences || !Array.isArray(data.favorites)) throw new Error('不是有效的 DevKit 设置文件');
      const old = preferences, oldFavorites = favorites;
      onChange(validatePreferences(data.preferences)); onFavorites(normalizeFavorites(data.favorites));
      onNotice('设置已导入', () => { onChange(old); onFavorites(oldFavorites); });
    } catch (error) { onNotice(`导入失败：${String(error)}`); }
  }
  return <div className="settings-page"><div className="settings-heading"><div className="eyebrow">PREFERENCES</div><h1>让工作台适合你</h1><p>偏好设置保存在本机，任务内容默认只留在内存中。</p></div>
    <WindowCloseSetting />
    <section className="settings-section"><h2><Monitor size={17} />外观与工作台</h2><label className="setting-row"><span><strong>主题</strong><small>跟随系统时会自动响应系统主题变化</small></span><select value={preferences.theme} onChange={event => update({ theme: event.target.value as Preferences['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label className="setting-row"><span><strong>界面密度</strong><small>调整工具列表和工作区的留白</small></span><select value={preferences.density} onChange={event => update({ density: event.target.value as Preferences['density'] })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><label className="setting-row"><span><strong>启动页面</strong><small>直接进入指定工具；不自动保存输入内容</small></span><select value={preferences.startup} onChange={event => update({ startup: event.target.value as Preferences['startup'] })}><option value="home">工作台总览</option>{tools.map(tool => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</select></label></section>
    <section className="settings-section"><h2>编辑器</h2><label className="setting-row"><span><strong>代码字号</strong><small>应用到所有任务和颜色代码区域</small></span><select value={preferences.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })}>{[12, 13, 14, 15, 16, 17, 18].map(size => <option key={size} value={size}>{size} px</option>)}</select></label><label className="setting-row"><span><strong>默认缩进</strong><small>Tab 缩进即时生效；格式化默认值用于新任务</small></span><select value={preferences.indent} onChange={event => update({ indent: event.target.value as Preferences['indent'] })}><option value="2">2 空格</option><option value="4">4 空格</option></select></label><label className="setting-row"><span><strong>默认布局</strong><small>任务中可以单独切换或最大化编辑区</small></span><select value={preferences.layout} onChange={event => update({ layout: event.target.value as Preferences['layout'] })}><option value="split">左右分栏</option><option value="stack">上下布局</option></select></label><label className="setting-row"><span><strong>自动换行</strong><small>长行在编辑区内折行显示</small></span><input type="checkbox" checked={preferences.wrap} onChange={event => update({ wrap: event.target.checked })} /></label></section>
    <section className="settings-section"><h2><ShieldCheck size={17} />数据与偏好</h2><p>仅主题、编辑器设置和收藏自动保存。任务需通过顶部“保存工作区”主动导出，恢复时作为新任务打开。密码和 JWT 默认从工作区文件中排除；颜色任务与图片不写入工作区文件。</p><div className="settings-buttons"><button className="secondary-button" onClick={() => void exportSettings()}><Download size={14} />导出设置与收藏</button><button className="secondary-button" onClick={() => file.current?.click()}><Upload size={14} />导入设置</button><button className="text-button" onClick={() => { const old = preferences; onChange(defaultPreferences); onNotice('偏好设置已恢复默认', () => onChange(old)); }}><RotateCcw size={14} />恢复默认偏好</button></div><input ref={file} className="sr-only" type="file" accept=".json" aria-label="导入设置文件" onChange={event => { void importSettings(event.target.files?.[0]); event.target.value = ''; }} /></section>
    <section className="settings-section"><h2><Keyboard size={17} />键盘操作</h2><dl className="shortcut-list"><div><dt>全局搜索</dt><dd>Ctrl / Cmd + K</dd></div><div><dt>执行当前任务</dt><dd>Ctrl / Cmd + Enter</dd></div><div><dt>查找文本</dt><dd>编辑器内 Ctrl / Cmd + F</dd></div><div><dt>新建同类任务</dt><dd>点击工具标题旁的 ＋</dd></div><div><dt>任务标签导航</dt><dd>方向键 / Home / End，Delete 关闭</dd></div><div><dt>离开编辑区</dt><dd>Esc，然后 Tab</dd></div></dl></section>
  </div>;
}
