import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from 'react';
import { ArrowUp, ArrowUpRight, ChevronDown, Clock3, LayoutGrid, List, Plus, Search, SearchX, Star } from 'lucide-react';
import { MotionGroup, useMotionList } from './Motion';
import { expandToolCard, useCardLight } from './tool-card-motion';
import SegmentedControl from './SegmentedControl';
import SmartOpen from './SmartOpen';
import { searchTools } from './discovery';
import { tools, type Options, type ToolId } from './tools';
import { categoryMeta, categoryOrder, toolIcons } from './ui';
import type { Task } from './workbench';

type OverviewScreen = 'launch' | 'library';

type Props = {
  onDetect: (id: ToolId, text: string, options?: Options) => void;
  onChoose: (id: ToolId, fresh?: boolean) => void;
  favorites: ToolId[];
  onFavorite: (id: ToolId) => void;
  mode: 'home' | 'favorites' | 'recent';
  homeVisit: number;
  recent: ToolId[];
  tasks: Task[];
  onResume: (id: string) => void;
  library: 'grid' | 'list';
  onLibrary: (view: 'grid' | 'list') => void;
};

function canScroll(element: HTMLElement | null, delta: number) {
  if (!element) return false;
  return delta < 0 ? element.scrollTop > 1 : element.scrollTop + element.clientHeight < element.scrollHeight - 1;
}

export default function Overview({ onDetect, onChoose, favorites, onFavorite, mode, homeVisit, recent, tasks, onResume, library, onLibrary }: Props) {
  const [screen, setScreen] = useState<OverviewScreen>('launch');
  const [category, setCategory] = useState('全部');
  const [query, setQuery] = useState('');
  const home = mode === 'home';
  const catalogOpen = screen === 'library';
  const scopeIds = mode === 'favorites' ? favorites : mode === 'recent' ? recent : null;
  const scopedTools = scopeIds ? tools.filter(tool => scopeIds.includes(tool.id)) : tools;
  const visible = searchTools(query, favorites, recent).filter(tool =>
    (!scopeIds || scopeIds.includes(tool.id)) && (category === '全部' || tool.category === category));
  const grid = useRef<HTMLDivElement>(null);
  const libraryVisible = !home || catalogOpen;
  useCardLight(grid, libraryVisible && library === 'grid');
  useMotionList(grid, visible.map(tool => tool.id).join('|') + library, !!query, libraryVisible);

  const viewport = useRef<HTMLDivElement>(null);
  const launchPane = useRef<HTMLElement>(null);
  const libraryPane = useRef<HTMLElement>(null);
  const launchLink = useRef<HTMLButtonElement>(null);
  const libraryTitle = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusAfterSwitch = useRef<'heading' | 'search' | null>(null);
  const switchTime = useRef(-Infinity);
  const gesture = useRef({ at: -Infinity, direction: 0, distance: 0, scrolled: false, consumed: false });
  const touchStart = useRef<{ x: number; y: number; screen: OverviewScreen } | null>(null);

  const changeScreen = useCallback((next: OverviewScreen, focus: 'heading' | 'search' = 'heading') => {
    if (next === screen) return;
    focusAfterSwitch.current = focus;
    switchTime.current = performance.now();
    setScreen(next);
  }, [screen]);

  useLayoutEffect(() => { setScreen('launch'); }, [homeVisit]);

  useLayoutEffect(() => {
    const focus = focusAfterSwitch.current;
    focusAfterSwitch.current = null;
    if (!home || !focus) return;
    const target = catalogOpen ? focus === 'search' ? search.current : libraryTitle.current : launchLink.current;
    target?.focus({ preventScroll: true });
  }, [catalogOpen, home]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== '/' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
        viewport.current?.closest('[hidden], [inert]') || document.querySelector('dialog[open]')) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input, textarea, select'))) return;
      event.preventDefault();
      if (home && !catalogOpen) changeScreen('library', 'search');
      else search.current?.focus();
    }
    window.addEventListener('keydown', focusSearch, true);
    return () => window.removeEventListener('keydown', focusSearch, true);
  }, [catalogOpen, changeScreen, home]);

  useEffect(() => {
    const element = viewport.current;
    if (!home || !element) return;
    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const now = performance.now();
      const direction = Math.sign(event.deltaY);
      let run = gesture.current;
      if (now - run.at > 160 || direction !== run.direction) {
        run = gesture.current = { at: now, direction, distance: 0, scrolled: false, consumed: false };
      }
      run.at = now;
      if (run.consumed || now - switchTime.current < 420) {
        run.consumed = true;
        event.preventDefault();
        return;
      }
      const pane = catalogOpen ? libraryPane.current : launchPane.current;
      const editor = event.target instanceof Element ? event.target.closest('textarea') : null;
      if (canScroll(editor, direction) || canScroll(pane, direction)) {
        run.scrolled = true;
        return;
      }
      // Reaching an edge during a scroll is different from starting a new gesture there.
      if (run.scrolled || direction !== (catalogOpen ? -1 : 1)) return;
      event.preventDefault();
      const units = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 120 : 1;
      run.distance += Math.abs(event.deltaY) * units;
      if (run.distance < 30) return;
      run.consumed = true;
      changeScreen(catalogOpen ? 'launch' : 'library');
    }
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [catalogOpen, changeScreen, home]);

  function startSwipe(event: TouchEvent) {
    touchStart.current = null;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || (event.target instanceof Element && event.target.closest('textarea, input'))) return;
    if (!canScroll(catalogOpen ? libraryPane.current : launchPane.current, catalogOpen ? -1 : 1)) {
      touchStart.current = { x: touch.clientX, y: touch.clientY, screen };
    }
  }

  function endSwipe(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || start.screen !== screen || performance.now() - switchTime.current < 420) return;
    const distance = (start.y - touch.clientY) * (catalogOpen ? -1 : 1);
    if (distance >= 55 && distance > Math.abs(start.x - touch.clientX)) changeScreen(catalogOpen ? 'launch' : 'library');
  }

  const toolLibrary = <section className="tool-library">
      <div className="library-heading">
        <div className={home ? 'home-library-title' : undefined}>
          {home && <button className="overview-back icon-button" type="button" aria-label="回到总览" title="回到总览" onClick={() => changeScreen('launch')}><ArrowUp size={17} aria-hidden="true" /></button>}
          <h2 id={home ? 'overview-library-title' : undefined} ref={libraryTitle} tabIndex={home ? -1 : undefined}>{home ? '工具库' : '工具'}<span>{visible.length}</span></h2>
        </div>
        <div className="library-controls">
          <div className="library-search">
            <Search size={16} aria-hidden="true" />
            <input ref={search} aria-label="筛选工具库" placeholder="搜索名称、用途或别名…" value={query} onChange={event => {
              if (libraryPane.current) libraryPane.current.scrollTop = 0;
              setQuery(event.target.value);
            }} />
            <kbd>/</kbd>
          </div>
          <SegmentedControl label="工具展示方式" className="view-toggle" value={library} onChange={onLibrary} options={[
            { value: 'grid', label: '卡片视图', content: <LayoutGrid size={15} /> },
            { value: 'list', label: '列表视图', content: <List size={15} /> },
          ]} />
        </div>
      </div>
      {!home && <MotionGroup className="category-filters" role="group" aria-label="按类别筛选">
          {['全部', ...categoryOrder].map(name => <button type="button" key={name} aria-pressed={category === name}
            className={category === name ? 'selected' : ''} onClick={() => setCategory(name)}>
            {name}<span>{name === '全部' ? scopedTools.length : scopedTools.filter(tool => tool.category === name).length}</span>
          </button>)}
      </MotionGroup>}
      <div ref={grid} className={`tool-grid ${library === 'list' ? 'tool-list' : ''}`}>{visible.map(tool => {
        const Icon = toolIcons[tool.id];
        const meta = categoryMeta[tool.category];
        const favorite = favorites.includes(tool.id);
        return <article className={`tool-card category-${meta.key}`} key={tool.id} data-motion-key={tool.id}>
          <button type="button" className="tool-card-open" onClick={event => expandToolCard(event.currentTarget.closest('article')!, () => onChoose(tool.id))}>
            <div className="tool-card-top"><span className="tool-icon"><Icon size={21} aria-hidden="true" /></span><ArrowUpRight className="card-arrow" size={16} aria-hidden="true" /></div>
            <div className="tool-card-copy">
              <div className="tool-card-title"><h3>{tool.name}</h3><span className="card-english">{tool.english}</span></div>
              <p>{tool.description}</p>
            </div>
          </button>
          <footer><span>{tool.category}</span><div>
            <button type="button" className="card-star" title="新建独立任务" aria-label={`新建${tool.name}任务`} onClick={() => onChoose(tool.id, true)}><Plus size={15} /></button>
            <button type="button" className={`card-star ${favorite ? 'is-favorite' : ''}`} aria-label={`${favorite ? '取消收藏' : '收藏'}${tool.name}`}
              aria-pressed={favorite} onClick={() => onFavorite(tool.id)}><Star size={15} fill={favorite ? 'currentColor' : 'none'} /></button>
          </div></footer>
        </article>;
      })}</div>
      {!visible.length && <div className="library-empty">
        <SearchX size={32} aria-hidden="true" />
        <h3>{mode === 'favorites' && !favorites.length ? '把常用工具收藏到这里' : mode === 'recent' && !recent.length ? '暂无最近使用的工具' : '没有匹配的工具'}</h3>
        <p>{mode === 'recent' && !recent.length ? '打开工具后，这里会记录本次会话使用过的工具。' : home ? '试试“令牌”“表格”或“驼峰”等关键词。' : '试试其他关键词，或调整分类。'}</p>
        <button type="button" onClick={() => { setCategory('全部'); setQuery(''); }}>清除筛选</button>
      </div>}
  </section>;

  if (!home) return <div className="overview" ref={viewport}>
    <header className="overview-heading"><h1>{mode === 'favorites' ? '我的收藏' : '最近使用'}</h1></header>
    {toolLibrary}
    <footer className="overview-footer"><span><span />所有处理在本地完成</span><span><kbd>Ctrl K</kbd> 快速打开 <i /> <kbd>Ctrl Enter</kbd> 运行</span></footer>
  </div>;

  const shortcuts = tasks.length
    ? tasks.slice(-3).reverse().map(task => ({ id: task.id, toolId: task.toolId, open: () => onResume(task.id), detail: task.fileName, running: task.status === 'running' }))
    : [...new Set<ToolId>([...favorites, 'json', 'diff', 'timestamp'])].slice(0, 3).map(toolId => ({ id: toolId, toolId, open: () => onChoose(toolId), detail: undefined, running: false }));

  return <div className="overview home-overview" ref={viewport} data-screen={screen}
    onTouchStart={startSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { touchStart.current = null; }}>
    <div className="overview-deck">
      <section className="home-launch" inert={catalogOpen} ref={launchPane} aria-labelledby="overview-title">
        <div className="home-launch-layout">
          <div className="home-launch-content">
            <header className="overview-heading home-heading">
              <h1 id="overview-title">开发工作台</h1>
              <p>粘贴内容，匹配本机工具</p>
            </header>
            <SmartOpen onOpen={onDetect} />
            <div className="quick-start" role="group" aria-label={tasks.length ? '继续工作' : '常用工具'}>
              <span aria-hidden="true">{tasks.length ? '继续工作' : '常用'}</span>
              {shortcuts.map(({ id, toolId, open, detail, running }) => {
                const tool = tools.find(item => item.id === toolId)!;
                const Icon = running ? Clock3 : toolIcons[toolId];
                return <button key={id} type="button" onClick={open} title={detail || (running ? '正在后台处理' : tool.name)}>
                  <Icon size={14} aria-hidden="true" />
                  <span>{tool.name}</span>
                </button>;
              })}
            </div>
          </div>
          <button type="button" ref={launchLink} className="overview-library-entry" aria-controls="overview-library"
            title="向下滚动或点击浏览工具库" onClick={() => changeScreen('library')}>浏览工具库<ChevronDown size={17} aria-hidden="true" /></button>
        </div>
      </section>
      <section id="overview-library" className="home-catalog" aria-labelledby="overview-library-title" inert={!catalogOpen} ref={libraryPane}>
        {toolLibrary}
      </section>
    </div>
  </div>;
}
