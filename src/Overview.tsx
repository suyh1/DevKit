import { useState } from 'react';
import { Search, Star, ArrowUpRight, Clock3, SearchX, LayoutGrid, List, Plus, ArrowRight } from 'lucide-react';
import { tools } from './tools';
import SmartOpen from './SmartOpen';
import type { Options, ToolId } from './tools';
import type { Task } from './workbench';
import { searchTools } from './discovery';
import { toolIcons, categoryMeta, categoryOrder } from './ui';

type Props = { onDetect: (id: ToolId, text: string, options?: Options) => void; onChoose: (id: ToolId, fresh?: boolean) => void; favorites: ToolId[]; onFavorite: (id: ToolId) => void; mode: 'home' | 'favorites' | 'recent'; recent: ToolId[]; tasks: Task[]; onResume: (id: string) => void; library: 'grid' | 'list'; onLibrary: (view: 'grid' | 'list') => void };

export default function Overview({ onDetect, onChoose, favorites, onFavorite, mode, recent, tasks, onResume, library, onLibrary }: Props) {
  const [category, setCategory] = useState('全部'), [query, setQuery] = useState('');
  const inScope = (id: ToolId) => mode === 'favorites' ? favorites.includes(id) : mode === 'recent' ? recent.includes(id) : true;
  const visible = searchTools(query, favorites, recent).filter(tool => inScope(tool.id) && (category === '全部' || tool.category === category));
  return <div className="overview">
    <section className="workbench-welcome"><div><div className="eyebrow">DEVKIT / LOCAL WORKSPACE</div><h1>{mode === 'favorites' ? '你的常用工具' : mode === 'recent' ? '最近使用' : '开始一段专注的工作'}</h1><p>{mode === 'home' ? '数据、代码、文本与颜色，在一个工作台里完成。' : mode === 'favorites' ? '收藏常用工具，让下一次操作更快开始。' : '本次会话打开过的工具，随时回来继续。'}</p></div><div className="workspace-stat"><strong>{tools.length}</strong><span>离线工具</span><i /><strong>{categoryOrder.length}</strong><span>任务分类</span></div></section>
    {mode === 'home' && <SmartOpen onOpen={onDetect} />}
    {mode === 'home' && tasks.length > 0 && <section className="resume-section"><div className="section-heading"><h2><Clock3 size={15} />继续工作<span>{tasks.length}</span></h2><small>内容仅保留在本次会话</small></div><div className="resume-grid">{tasks.slice(-4).reverse().map(task => { const tool = tools.find(item => item.id === task.toolId)!, Icon = toolIcons[task.toolId]; return <button key={task.id} onClick={() => onResume(task.id)}><span className={`tool-icon category-${categoryMeta[tool.category].key}`}><Icon size={19} /></span><span><strong>{tool.name}</strong><small>{task.fileName || (task.status === 'running' ? '正在后台处理' : task.input ? `${task.input.length.toLocaleString()} 字符 · 继续编辑` : '准备开始')}</small></span><ArrowRight size={15} /></button>; })}</div></section>}
    <section className="tool-library"><div className="library-heading"><div><h2>{mode === 'home' ? '全部工具' : mode === 'favorites' ? '我的收藏' : '最近工具'}<span>{visible.length}</span></h2><p>按任务寻找工具，点击打开，＋ 创建独立任务。</p></div><div className="library-controls"><div className="library-search"><Search size={16} /><input aria-label="筛选工具库" placeholder="搜索名称、用途或别名…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>/</kbd></div><div className="view-toggle"><button aria-label="卡片视图" aria-pressed={library === 'grid'} onClick={() => onLibrary('grid')}><LayoutGrid size={15} /></button><button aria-label="列表视图" aria-pressed={library === 'list'} onClick={() => onLibrary('list')}><List size={15} /></button></div></div></div>
      <div className="category-filters" aria-label="按类别筛选">{['全部', ...categoryOrder].map(name => <button key={name} aria-pressed={category === name} className={category === name ? 'selected' : ''} onClick={() => setCategory(name)}>{name}<span>{tools.filter(tool => inScope(tool.id) && (name === '全部' || tool.category === name)).length}</span></button>)}</div>
      <div className={`tool-grid ${library === 'list' ? 'tool-list' : ''}`}>{visible.map(tool => { const Icon = toolIcons[tool.id], meta = categoryMeta[tool.category]; return <article className={`tool-card category-${meta.key}`} key={tool.id}><button className="tool-card-open" onClick={() => onChoose(tool.id)}><div className="tool-card-top"><span className="tool-icon"><Icon size={21} /></span><ArrowUpRight className="card-arrow" size={16} /></div><div className="tool-card-copy"><h3>{tool.name}</h3><span className="card-english">{tool.english}</span><p>{tool.description}</p></div></button><footer><span>{tool.category}</span><div><button className="card-star" title="新建独立任务" aria-label={`新建${tool.name}任务`} onClick={() => onChoose(tool.id, true)}><Plus size={15} /></button><button className={`card-star ${favorites.includes(tool.id) ? 'is-favorite' : ''}`} aria-label={`${favorites.includes(tool.id) ? '取消收藏' : '收藏'}${tool.name}`} aria-pressed={favorites.includes(tool.id)} onClick={() => onFavorite(tool.id)}><Star size={15} fill={favorites.includes(tool.id) ? 'currentColor' : 'none'} /></button></div></footer></article>; })}</div>
      {!visible.length && <div className="library-empty"><SearchX size={32} /><h3>{mode === 'favorites' && !favorites.length ? '把常用工具收藏到这里' : '没有匹配的工具'}</h3><p>{mode === 'recent' && !recent.length ? '打开工具后，这里会记录本次会话的使用足迹。' : '试试“令牌”“表格”“驼峰”等关键词，或调整分类。'}</p><button onClick={() => { setCategory('全部'); setQuery(''); }}>清除筛选</button></div>}
    </section>
    <footer className="overview-footer"><span><span />所有处理在本地完成</span><span><kbd>Ctrl K</kbd> 快速打开 <i /> <kbd>Ctrl Enter</kbd> 运行</span></footer>
  </div>;
}
