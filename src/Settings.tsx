import FloatingDetails from './FloatingDetails';
import type { NoticeKind } from './ToastStack';
import SegmentedControl from './SegmentedControl';
import { themeStyles } from './themes';
import { useRef } from 'react';
import { Monitor, Download, Upload, RotateCcw, ShieldCheck, Keyboard, Info } from 'lucide-react';
import { tools } from './tools';
import { defaultPreferences, validatePreferences, normalizeFavorites } from './workbench';
import type { Preferences } from './workbench';
import type { ToolId } from './tools';
import { saveText } from './files';
import { WindowCloseSetting } from './DesktopClose';
import AboutDetails from './AboutDetails';

export default function Settings({ preferences, onChange, favorites, onFavorites, onNotice }: { preferences: Preferences; onChange: (value: Preferences) => void; favorites: ToolId[]; onFavorites: (value: ToolId[]) => void; onNotice: (message: string, kind?: NoticeKind, undo?: () => void) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Preferences>) => onChange({ ...preferences, ...patch });
  async function exportSettings() {
    try { await saveText(JSON.stringify({ format: 'devkit-preferences', version: 1, preferences, favorites }, null, 2), 'devkit-settings.json', onNotice); }
    catch (error) { onNotice(`导出失败：${String(error)}`, 'error'); }
  }
  async function importSettings(source?: File) {
    if (!source) return;
    try {
      if (source.size > 100_000) throw new Error('设置文件过大');
      const data = JSON.parse(await source.text());
      if (data?.format !== 'devkit-preferences' || data.version !== 1 || !data.preferences || !Array.isArray(data.favorites)) throw new Error('不是有效的 DevKit 设置文件');
      const old = preferences, oldFavorites = favorites;
      onChange(validatePreferences(data.preferences)); onFavorites(normalizeFavorites(data.favorites));
      onNotice('设置已导入', 'success', () => { onChange(old); onFavorites(oldFavorites); });
    } catch (error) { onNotice(`导入失败：${String(error)}`, 'error'); }
  }
  return <div className="settings-page"><div className="settings-heading"><h1>偏好设置</h1><p>偏好设置保存在本机，任务内容默认只留在内存中。</p></div>
    <section className="settings-section"><h2><Monitor size={17} />外观</h2>
      <div className="setting-row">
        <span><strong>明暗模式</strong><small>跟随系统时会自动响应系统主题变化</small></span>
        <SegmentedControl label="明暗模式" value={preferences.theme} onChange={(theme) => update({ theme })}
          options={[{ value: 'system', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} />
      </div>
      <div className="setting-row">
        <span><strong>界面密度</strong><small>调整工具列表和工作区的留白</small></span>
        <SegmentedControl label="界面密度" value={preferences.density} onChange={(density) => update({ density })}
          options={[{ value: 'comfortable', label: '舒适' }, { value: 'compact', label: '紧凑' }]} />
      </div>
      <label className="setting-row"><span><strong>启动页面</strong><small>直接进入指定工具；不自动保存输入内容</small></span><select value={preferences.startup} onChange={event => update({ startup: event.target.value as Preferences['startup'] })}><option value="home">工作台总览</option>{tools.map(tool => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</select></label><FloatingDetails className="setting-theme-library"><summary>主题风格 · {themeStyles.find(style => style.id === preferences.themeStyle)?.name}</summary><fieldset className="theme-picker">
      <legend>主题风格</legend>
      <p>每套风格都支持浅色、深色与跟随系统。</p>
      <div className="theme-options">{themeStyles.map(style => (
        <label key={style.id} className="theme-option">
          <input type="radio" name="theme-style" value={style.id} checked={preferences.themeStyle === style.id} onChange={() => update({ themeStyle: style.id })} />
          <span className="theme-swatches" aria-hidden="true">{style.colors.map(color => <i key={color} style={{ background: color }} />)}</span>
          <strong>{style.name}</strong><small>{style.description}</small>
        </label>
      ))}</div>
    </fieldset></FloatingDetails></section>
    <section className="settings-section"><h2>编辑器</h2><label className="setting-row"><span><strong>代码字号</strong><small>应用到所有任务和颜色代码区域</small></span><span className="font-slider"><code style={{ fontSize: preferences.fontSize }}>Aa 01</code><input aria-label="代码字号" list="font-size-ticks" type="range" min={12} max={18} value={preferences.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })} /><datalist id="font-size-ticks">{[12,13,14,15,16,17,18].map(size => <option key={size} value={size} />)}</datalist><output>{preferences.fontSize} px</output></span></label>
      <div className="setting-row">
        <span><strong>默认缩进</strong><small>Tab 缩进即时生效；格式化默认值用于新任务</small></span>
        <SegmentedControl label="默认缩进" value={preferences.indent} onChange={(indent) => update({ indent })}
          options={[{ value: '2', label: '2 空格' }, { value: '4', label: '4 空格' }]} />
      </div>
      <div className="setting-row">
        <span><strong>默认布局</strong><small>任务中可以单独切换或最大化编辑区</small></span>
        <SegmentedControl label="默认布局" value={preferences.layout} onChange={(layout) => update({ layout })}
          options={[{ value: 'split', label: '左右分栏' }, { value: 'stack', label: '上下布局' }]} />
      </div>
      <label className="setting-row"><span><strong>自动换行</strong><small>长行在编辑区内折行显示</small></span><input className="liquid-toggle" role="switch" type="checkbox" checked={preferences.wrap} onChange={event => update({ wrap: event.target.checked })} /></label></section>
    <WindowCloseSetting />
    <section className="settings-section">
      <h2><Monitor size={17} />性能</h2>
      <div className="setting-row">
        <span><strong>运行模式</strong><small>性能模式减少动效与背景模糊，并降低状态和文件日志的自动刷新频率。</small></span>
        <SegmentedControl label="运行模式" value={preferences.displayMode} onChange={(displayMode) => update({ displayMode })}
          options={[{ value: 'normal', label: '正常模式' }, { value: 'performance', label: '性能模式' }]} />
      </div>
    </section>
    <section className="settings-section"><h2><ShieldCheck size={17} />数据与偏好</h2><p>主题、编辑器设置、共享栏目顺序和收藏会自动保存。任务需通过顶部“保存工作区”主动导出，恢复时作为新任务打开。密码、JWT 和 HMAC 默认从工作区文件中排除；颜色任务与图片不写入工作区文件。</p><div className="settings-buttons"><button className="secondary-button" onClick={() => void exportSettings()}><Download size={14} />导出设置与收藏</button><button className="file-pick-button" onClick={() => file.current?.click()}><Upload size={14} />导入设置</button><button className="text-button" onClick={() => { const old = preferences; onChange(defaultPreferences); onNotice('偏好设置已恢复默认', 'success', () => onChange(old)); }}><RotateCcw size={14} />恢复默认偏好</button></div><input ref={file} hidden type="file" accept=".json" aria-label="导入设置文件" onChange={event => { void importSettings(event.target.files?.[0]); event.target.value = ''; }} /></section>
    <section className="settings-section"><h2><Keyboard size={17} />键盘操作</h2><dl className="shortcut-list"><div><dt>全局搜索</dt><dd>Ctrl / Cmd + K</dd></div><div><dt>执行当前任务</dt><dd>Ctrl / Cmd + Enter</dd></div><div><dt>查找文本</dt><dd>编辑器内 Ctrl / Cmd + F</dd></div><div><dt>新建同类任务</dt><dd>点击工具标题旁的 ＋</dd></div><div><dt>任务标签导航</dt><dd>方向键 / Home / End，Delete 关闭</dd></div><div><dt>离开编辑区</dt><dd>Esc，然后 Tab</dd></div></dl></section>
    <section className="settings-section" aria-labelledby="devkit-about-heading">
      <h2 id="devkit-about-heading"><Info size={17} aria-hidden="true" />关于 DevKit</h2>
      <AboutDetails onNotice={onNotice} />
    </section>
  </div>;
}
