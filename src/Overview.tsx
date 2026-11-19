import { useMotionList, MotionGroup } from './Motion';
import { useRef, useState } from 'react';
import { Search, Star, ArrowUpRight, Clock3, SearchX, LayoutGrid, List, Plus, ArrowRight } from 'lucide-react';
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
  const activeScope = mode === 'home' ? scope : mode;
  const inScope = (id: ToolId) => activeScope === 'favorites' ? favorites.includes(id) : activeScope === 'recent' ? recent.includes(id) : true;
  const visible = searchTools(query, favorites, recent).filter(tool => inScope(tool.id) && (category === '全部' || tool.category === category));
  const grid = useRef<HTMLDivElement>(null);
  useMotionList(grid, visible.map(tool => tool.id).join('|') + library, !!query);
  return <div className="overview">
    <header className="overview-heading"><h1>{mode === 'home' ? '工作台' : mode === 'favorites' ? '我的收藏' : '最近使用'}</h1></header>
    {mode === 'home' && tasks.length > 0 && <section className="resume-section"><div className="section-heading"><h2><Clock3 size={15} />继续工作<span>{tasks.length}</span></h2><small>内容仅保留在本次会话</small></div><div className="resume-grid">{tasks.slice(-4).reverse().map(task => { const tool = tools.find(item => item.id === task.toolId)!, Icon = toolIcons[task.toolId]; return <button key={task.id} onClick={() => onResume(task.id)}><span className={`tool-icon category-${categoryMeta[tool.category].key}`}><Icon size={19} /></span><span><strong>{tool.name}</strong><small>{task.fileName || (task.status === 'running' ? '正在后台处理' : task.input ? `${task.input.length.toLocaleString()} 字符 · 继续编辑` : '准备开始')}</small></span><ArrowRight size={15} /></button>; })}</div></section>}
    {mode === 'home' && <div className="home-launch">
      <SmartOpen onOpen={onDetect} />
      <section className="quick-start-card"><h2>常用工具</h2><div className="quick-start-grid">
        {Array.from(new Set<ToolId>([...favorites, 'json', 'diff', 'timestamp', 'uuid', 'color-palette'])).slice(0, 6).map(id => {
          const tool = tools.find(item => item.id === id)!;
          const Icon = toolIcons[id];
          return <button key={id} type="button" onClick={() => onChoose(id)}>
            <span className={`tool-icon category-${categoryMeta[tool.category].key}`}><Icon size={17} /></span><span>{tool.name}</span>
          </button>;
        })}
      </div></section>
    </div>}
    <section className="tool-library"><div className="library-heading"><h2>{mode === 'home' ? '工具库' : '工具'}<span>{visible.length}</span></h2><div className="library-controls"><div className="library-search"><Search size={16} /><input aria-label="筛选工具库" placeholder="搜索名称、用途或别名…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>/</kbd></div><SegmentedControl label="工具展示方式" className="view-toggle" value={library} onChange={onLibrary} options={[{ value: 'grid', label: '卡片视图', content: <LayoutGrid size={15} /> }, { value: 'list', label: '列表视图', content: <List size={15} /> }]} /></div></div>
      {mode === 'home' && <SegmentedControl label="工具范围" className="library-scope" value={scope} onChange={value => { setScope(value); setCategory('全部'); }} options={[{ value: 'all', label: '全部工具', content: <><LayoutGrid size={13} />全部工具</> }, { value: 'favorites', label: '常用收藏', content: <><Star size={13} />常用收藏</> }, { value: 'recent', label: '最近使用', content: <><Clock3 size={13} />最近使用</> }]} />}
      <MotionGroup className="category-filters" aria-label="按类别筛选">{['全部', ...categoryOrder].map(name => <button key={name} aria-pressed={category === name} className={category === name ? 'selected' : ''} onClick={() => setCategory(name)}>{name}<span>{tools.filter(tool => inScope(tool.id) && (name === '全部' || tool.category === name)).length}</span></button>)}</MotionGroup>
      <div ref={grid} className={`tool-grid ${library === 'list' ? 'tool-list' : ''}`}>{visible.map(tool => { const Icon = toolIcons[tool.id], meta = categoryMeta[tool.category]; return <article className={`tool-card category-${meta.key}`} key={tool.id} data-motion-key={tool.id}><button className="tool-card-open" onClick={() => onChoose(tool.id)}><div className="tool-card-top"><span className="tool-icon"><Icon size={21} /></span><ArrowUpRight className="card-arrow" size={16} /></div><div className="tool-card-copy"><h3>{tool.name}</h3><span className="card-english">{tool.english}</span><p>{tool.description}</p></div></button><footer><span>{tool.category}</span><div><button className="card-star" title="新建独立任务" aria-label={`新建${tool.name}任务`} onClick={() => onChoose(tool.id, true)}><Plus size={15} /></button><button className={`card-star ${favorites.includes(tool.id) ? 'is-favorite' : ''}`} aria-label={`${favorites.includes(tool.id) ? '取消收藏' : '收藏'}${tool.name}`} aria-pressed={favorites.includes(tool.id)} onClick={() => onFavorite(tool.id)}><Star size={15} fill={favorites.includes(tool.id) ? 'currentColor' : 'none'} /></button></div></footer></article>; })}</div>
      {!visible.length && <div className="library-empty"><SearchX size={32} /><h3>{activeScope === 'favorites' && !favorites.length ? '把常用工具收藏到这里' : activeScope === 'recent' && !recent.length ? '暂无最近使用的工具' : '没有匹配的工具'}</h3><p>{activeScope === 'recent' && !recent.length ? '打开工具后，这里会记录本次会话的使用足迹。' : '试试“令牌”“表格”“驼峰”等关键词，或调整分类。'}</p><button onClick={() => { setCategory('全部'); setQuery(''); if (mode === 'home') setScope('all'); }}>清除筛选</button></div>}
    </section>
    <footer className="overview-footer"><span><span />所有处理在本地完成</span><span><kbd>Ctrl K</kbd> 快速打开 <i /> <kbd>Ctrl Enter</kbd> 运行</span></footer>
  </div>;
}
