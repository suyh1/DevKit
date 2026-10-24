import { useState } from 'react';
import { Search, Star, ArrowUpRight, Clock3, SearchX, LayoutGrid, List, Plus, ArrowRight, ShieldCheck, Sparkles, Command, Pause, Play, Braces, Palette } from 'lucide-react';
import { tools } from './tools';
import SmartOpen from './SmartOpen';
import SegmentedControl from './SegmentedControl';
import type { Options, ToolId } from './tools';
import type { Task } from './workbench';
import { searchTools } from './discovery';
import { toolIcons, categoryMeta, categoryOrder } from './ui';

type Props = { onDetect: (id: ToolId, text: string, options?: Options) => void; onChoose: (id: ToolId, fresh?: boolean) => void; favorites: ToolId[]; onFavorite: (id: ToolId) => void; mode: 'home' | 'favorites' | 'recent'; recent: ToolId[]; tasks: Task[]; onResume: (id: string) => void; library: 'grid' | 'list'; onLibrary: (view: 'grid' | 'list') => void };

export default function Overview({ onDetect, onChoose, favorites, onFavorite, mode, recent, tasks, onResume, library, onLibrary }: Props) {
  const [category, setCategory] = useState('全部'), [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'favorites' | 'recent'>('all');
  const [marqueePaused, setMarqueePaused] = useState(false);
  const activeScope = mode === 'home' ? scope : mode;
  const inScope = (id: ToolId) => activeScope === 'favorites' ? favorites.includes(id) : activeScope === 'recent' ? recent.includes(id) : true;
  const visible = searchTools(query, favorites, recent).filter(tool => inScope(tool.id) && (category === '全部' || tool.category === category));
  return <div className="overview">
    {mode === 'home' ? <>
      <div className="home-bento">
        <section className="welcome-card">
          <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
          <div className="welcome-content"><div className="eyebrow"><span /> YOUR EVERYDAY WORKSPACE</div>
            <h1>让专注发生，<br /><em>让灵感成形。</em></h1>
            <p>数据、代码、文本与颜色。<br />把日常的繁琐，变成顺手的片刻。</p>
            <div className="welcome-actions"><button className="run-button" onClick={() => { const search = document.querySelector<HTMLInputElement>('.overview-workspace:not([hidden]) .library-search input'); search?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); search?.focus({ preventScroll: true }); }}>探索工具库<ArrowUpRight size={15} /></button><span><ShieldCheck size={14} />本地运行，安心创造</span></div>
          </div>
          <div className="welcome-art" aria-hidden="true"><div className="art-orbit" /><div className="art-code"><div><span /><span /><span /><small>hello, devkit</small></div><code><b>const</b> focus = {'{'}<br />&nbsp; space: <i>"for ideas"</i>,<br />&nbsp; flow: <i>true</i><br />{'}'};</code><footer><span />ready when you are<Command size={12} /></footer></div><div className="art-spark"><Sparkles size={22} /></div></div>
        </section>
        <section className="quick-start-card"><div className="bento-label"><Command size={14} /><span>随手开始</span><span>QUICK START</span></div><h2>小工具，大有用处。</h2><p>常用的几个，已经为你准备好。</p><div className="quick-start-grid">{(['json', 'diff', 'timestamp', 'uuid'] as ToolId[]).map(id => { const tool = tools.find(item => item.id === id)!, Icon = toolIcons[id]; return <button key={id} onClick={() => onChoose(id)}><span className={`tool-icon category-${categoryMeta[tool.category].key}`}><Icon size={18} /></span><span>{tool.name}</span><ArrowUpRight size={13} /></button>; })}</div><div className="quick-start-note"><strong>{tools.length}</strong> 个工具<span>·</span><strong>{categoryOrder.length}</strong> 种可能</div></section>
        <SmartOpen onOpen={onDetect} />
        <button className="color-story-card" onClick={() => onChoose('color-palette')}><div className="bento-label"><Palette size={14} /><span>给灵感一点颜色</span><ArrowUpRight size={17} /></div><div className="color-story-swatches" aria-hidden="true"><i /><i /><i /><i /><i /></div><div><h2>下一组好配色，从这里开始。</h2><p>取色、搭配、渐变，一气呵成。</p></div></button>
      </div>
      <div className="category-marquee" data-paused={marqueePaused}><span className="marquee-label"><Braces size={13} />为日常开发而生</span><div className="marquee-viewport" aria-hidden="true"><div className="marquee-track">{[0, 1].map(copy => <div className="marquee-group" key={copy}>{categoryOrder.map(name => <span key={name}><i />{name}<small>{tools.filter(tool => tool.category === name).length}</small></span>)}</div>)}</div></div><button className="icon-button" aria-label={marqueePaused ? '播放类别滚动' : '暂停类别滚动'} aria-pressed={marqueePaused} onClick={() => setMarqueePaused(current => !current)}>{marqueePaused ? <Play size={13} /> : <Pause size={13} />}</button></div>
    </> : <section className="workbench-welcome collection-welcome"><div><div className="eyebrow">YOUR PERSONAL COLLECTION</div><h1>{mode === 'favorites' ? '你的常用工具' : '最近使用'}</h1><p>{mode === 'favorites' ? '收藏常用工具，让下一次操作更快开始。' : '本次会话打开过的工具，随时回来继续。'}</p></div><span className="collection-symbol">{mode === 'favorites' ? <Star size={30} /> : <Clock3 size={30} />}</span></section>}
    {mode === 'home' && tasks.length > 0 && <section className="resume-section"><div className="section-heading"><h2><Clock3 size={15} />继续工作<span>{tasks.length}</span></h2><small>内容仅保留在本次会话</small></div><div className="resume-grid">{tasks.slice(-4).reverse().map(task => { const tool = tools.find(item => item.id === task.toolId)!, Icon = toolIcons[task.toolId]; return <button key={task.id} onClick={() => onResume(task.id)}><span className={`tool-icon category-${categoryMeta[tool.category].key}`}><Icon size={19} /></span><span><strong>{tool.name}</strong><small>{task.fileName || (task.status === 'running' ? '正在后台处理' : task.input ? `${task.input.length.toLocaleString()} 字符 · 继续编辑` : '准备开始')}</small></span><ArrowRight size={15} /></button>; })}</div></section>}
    <section className="tool-library"><div className="library-heading"><div><div className="eyebrow">MADE FOR YOUR FLOW</div><h2>{mode === 'home' ? '发现你的下一件利器' : mode === 'favorites' ? '我的收藏' : '最近工具'}<span>{visible.length}</span></h2><p>少一点重复，多一点心流。选择工具，即刻开始。</p></div><div className="library-controls"><div className="library-search"><Search size={16} /><input aria-label="筛选工具库" placeholder="搜索名称、用途或别名…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>/</kbd></div><SegmentedControl label="工具展示方式" className="view-toggle" value={library} onChange={onLibrary} options={[{ value: 'grid', label: '卡片视图', content: <LayoutGrid size={15} /> }, { value: 'list', label: '列表视图', content: <List size={15} /> }]} /></div></div>
      {mode === 'home' && <SegmentedControl label="工具范围" className="library-scope" value={scope} onChange={value => { setScope(value); setCategory('全部'); }} options={[{ value: 'all', label: '全部工具', content: <><LayoutGrid size={13} />全部工具</> }, { value: 'favorites', label: '常用收藏', content: <><Star size={13} />常用收藏</> }, { value: 'recent', label: '最近使用', content: <><Clock3 size={13} />最近使用</> }]} />}
      <div className="category-filters" aria-label="按类别筛选">{['全部', ...categoryOrder].map(name => <button key={name} aria-pressed={category === name} className={category === name ? 'selected' : ''} onClick={() => setCategory(name)}>{name}<span>{tools.filter(tool => inScope(tool.id) && (name === '全部' || tool.category === name)).length}</span></button>)}</div>
      <div className={`tool-grid ${library === 'list' ? 'tool-list' : ''}`}>{visible.map(tool => { const Icon = toolIcons[tool.id], meta = categoryMeta[tool.category]; return <article className={`tool-card category-${meta.key}`} key={tool.id}><button className="tool-card-open" onClick={() => onChoose(tool.id)}><div className="tool-card-top"><span className="tool-icon"><Icon size={21} /></span><ArrowUpRight className="card-arrow" size={16} /></div><div className="tool-card-copy"><h3>{tool.name}</h3><span className="card-english">{tool.english}</span><p>{tool.description}</p></div></button><footer><span>{tool.category}</span><div><button className="card-star" title="新建独立任务" aria-label={`新建${tool.name}任务`} onClick={() => onChoose(tool.id, true)}><Plus size={15} /></button><button className={`card-star ${favorites.includes(tool.id) ? 'is-favorite' : ''}`} aria-label={`${favorites.includes(tool.id) ? '取消收藏' : '收藏'}${tool.name}`} aria-pressed={favorites.includes(tool.id)} onClick={() => onFavorite(tool.id)}><Star size={15} fill={favorites.includes(tool.id) ? 'currentColor' : 'none'} /></button></div></footer></article>; })}</div>
      {!visible.length && <div className="library-empty"><SearchX size={32} /><h3>{activeScope === 'favorites' && !favorites.length ? '把常用工具收藏到这里' : activeScope === 'recent' && !recent.length ? '下一段心流，从打开工具开始' : '没有匹配的工具'}</h3><p>{activeScope === 'recent' && !recent.length ? '打开工具后，这里会记录本次会话的使用足迹。' : '试试“令牌”“表格”“驼峰”等关键词，或调整分类。'}</p><button onClick={() => { setCategory('全部'); setQuery(''); if (mode === 'home') setScope('all'); }}>清除筛选</button></div>}
    </section>
    <footer className="overview-footer"><span><span />所有处理在本地完成</span><span><kbd>Ctrl K</kbd> 快速打开 <i /> <kbd>Ctrl Enter</kbd> 运行</span></footer>
  </div>;
}
