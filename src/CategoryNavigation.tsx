import { MotionPresence, useMotionHeight } from './Motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowLeft, Binary, Braces, CaseSensitive, ChevronRight, Clock3, Code2, Globe, ListOrdered, Palette, ShieldCheck, X } from 'lucide-react';
import { categories } from './catalog';
import type { WorkspaceModule, WorkspaceModuleId } from './catalog';
import { tools } from './tools';
import type { ToolId } from './tools';
import { toolIcons, workspaceModuleNav } from './ui';
import type { Task } from './workbench';

const categoryIcons = { data: Braces, code: Code2, encode: Binary, text: CaseSensitive, utility: Clock3, security: ShieldCheck, color: Palette };

export default function CategoryNavigation({ activeToolId, tasks, narrow, onChoose, page, onChooseWorkspace, dismissKey, sharedModules, onEditSharedOrder }: {
  activeToolId?: ToolId;
  tasks: Task[];
  narrow: boolean;
  onChoose: (id: ToolId) => void;
  page: string;
  onChooseWorkspace: (id: WorkspaceModuleId) => void;
  sharedModules: WorkspaceModule[];
  onEditSharedOrder: (trigger: HTMLButtonElement) => void;
  dismissKey?: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusTo = useRef<string | null>(null);
  const shared = openKey === 'shared';
  const category = categories.find(item => item.key === openKey);
  const selectedCategory = tools.find(tool => tool.id === activeToolId)?.category;
  const selectedWorkspace = sharedModules.find(item => item.id === page);
  const groupedTools = category ? category.ids.map(id => tools.find(tool => tool.id === id)!) : [];
  const title = shared ? '共享栏目' : category?.name;
  useMotionHeight(panel, openKey);
  useEffect(() => { setOpenKey(null); }, [dismissKey, narrow]);

  function close(restoreFocus = false) {
    if (restoreFocus) restoreFocusTo.current = openKey;
    setOpenKey(null);
  }

  function toggle(key: string) {
    if (key === openKey) close(true);
    else setOpenKey(key);
  }

  useLayoutEffect(() => {
    if (!openKey) {
      if (restoreFocusTo.current) triggers.current.get(restoreFocusTo.current)?.focus({ preventScroll: true });
      restoreFocusTo.current = null;
      return;
    }
    const anchor = triggers.current.get(openKey), surface = panel.current;
    if (!anchor || !surface) return;
    // The native top layer escapes the glass sidebar's stacking context and
    // fixed-position containing block, while preserving DOM keyboard order.
    if (!narrow && !surface.matches(':popover-open')) surface.showPopover();
    function place() {
      if (narrow || !anchor || !surface) return;
      const sidebar = root.current?.closest('aside')?.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const left = Math.max(12, Math.min((sidebar?.right ?? rect.right) + 10, window.innerWidth - width - 12));
      // Position against layout height; the entrance animation temporarily scales its visual bounds.
      const height = surface.offsetHeight;
      const top = Math.max(12, Math.min(rect.top, window.innerHeight - height - 12));
      Object.assign(surface.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(surface);
    const sidebar = root.current?.closest('aside');
    if (sidebar) observer.observe(sidebar);
    window.addEventListener('resize', place);
    // A short window may scroll the category list without moving the sidebar.
    const list = root.current?.querySelector('.category-list');
    list?.addEventListener('scroll', place);
    const preferred = surface.querySelector<HTMLButtonElement>('[aria-current="page"]') ?? surface.querySelector<HTMLButtonElement>('.category-tool');
    preferred?.focus({ preventScroll: true });
    // Scroll only the tool list: scrollIntoView can also move the clipped app shell
    // while the fixed panel's first measured position is being committed.
    const toolList = surface.querySelector<HTMLElement>('.category-tool-list');
    if (preferred && toolList) {
      const item = preferred.getBoundingClientRect(), viewport = toolList.getBoundingClientRect();
      if (item.bottom > viewport.bottom - 5) toolList.scrollTop += item.bottom - viewport.bottom + 5;
      else if (item.top < viewport.top + 5) toolList.scrollTop += item.top - viewport.top - 5;
    }
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      list?.removeEventListener('scroll', place);
    };
  }, [openKey, narrow]);

  useEffect(() => {
    if (!openKey) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpenKey(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      restoreFocusTo.current = openKey;
      setOpenKey(null);
    };
    document.addEventListener('pointerdown', outside, true);
    // Handle the inner panel before the mobile drawer's Escape handler.
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [openKey]);

  function move(event: KeyboardEvent<HTMLElement>, selector: string, container: HTMLElement) {
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(selector)];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return <div className={`category-navigation ${openKey ? 'has-open-category' : ''}`} ref={root} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpenKey(null);
  }}>
    <button ref={button => { if (button) triggers.current.set('shared', button); else triggers.current.delete('shared'); }}
      className={`nav-item shared-sidebar-trigger ${shared || selectedWorkspace ? 'active' : ''}`} title="共享栏目" aria-label="共享栏目"
      aria-expanded={shared} aria-controls={shared ? 'shared-sidebar-panel' : undefined} onClick={() => toggle('shared')}>
      <Globe size={17} /><span>共享栏目</span><small>{selectedWorkspace?.name ?? sharedModules.length}</small><ChevronRight className="category-trigger-arrow" size={14} />
    </button>
    <div className="nav-caption"><span>按任务分类</span><small>{categories.length} 个分组</small></div>
    <nav className="category-list" aria-label="工具分类" hidden={narrow && !!openKey} onKeyDown={event => move(event, '.category-trigger', event.currentTarget)}>
      {categories.map(item => {
        const Icon = categoryIcons[item.key as keyof typeof categoryIcons];
        const expanded = item.key === openKey, active = item.name === selectedCategory;
        return <button key={item.key} ref={button => { if (button) triggers.current.set(item.key, button); else triggers.current.delete(item.key); }}
          className={`category-trigger ${active ? 'current-category' : ''} ${expanded ? 'is-open' : ''}`}
          data-category={item.key} aria-label={`${item.name}，${item.ids.length} 个工具`} title={item.name}
          aria-expanded={expanded} aria-controls={expanded ? 'category-tool-panel' : undefined}
          onClick={() => toggle(item.key)}>
          <span className={`category-trigger-icon category-${item.key}`}><Icon size={18} /></span>
          <span className="category-trigger-name">{item.name}</span><small>{item.ids.length}</small><ChevronRight className="category-trigger-arrow" size={14} />
        </button>;
      })}
    </nav>
    <MotionPresence kind="popover" present={!!title}>{title && <section id={shared ? 'shared-sidebar-panel' : 'category-tool-panel'} popover={narrow ? undefined : 'manual'} className={`category-panel ${narrow ? 'category-panel-inline' : ''}`} ref={panel} aria-labelledby="category-panel-title">
      <header className="category-panel-heading">
        {narrow && <button className="icon-button category-back" aria-label={shared ? '返回侧栏导航' : '返回工具分类'} onClick={() => close(true)}><ArrowLeft size={18} /></button>}
        <div><h2 id="category-panel-title">{title}{category && <small>{groupedTools.length} 个工具</small>}</h2>{category && <p>{category.description}</p>}</div>
        {shared && <button className="shared-sort-action" aria-haspopup="dialog" onClick={() => {
          const anchor = triggers.current.get('shared');
          if (anchor) { close(); onEditSharedOrder(anchor); }
        }}><ListOrdered size={16} />排序</button>}
        {!narrow && <button className="icon-button" aria-label={shared ? '关闭共享栏目面板' : '关闭分类工具面板'} onClick={() => close(true)}><X size={17} /></button>}
      </header>
      <nav className="category-tool-list" aria-label={shared ? title : `${title}工具`} onKeyDown={event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); close(true); }
        else move(event, '.category-tool', event.currentTarget);
      }}>
        {shared ? sharedModules.map(item => {
          const { Icon, hint } = workspaceModuleNav[item.id];
          return <button key={item.id} className={`category-tool ${item.id === page ? 'active' : ''}`} title={item.name}
            aria-current={item.id === page ? 'page' : undefined} onClick={() => { close(true); onChooseWorkspace(item.id); }}>
            <span className="tool-icon"><Icon size={18} /></span>
            <span className="category-tool-copy"><strong>{item.name}</strong><small>{hint}</small></span>
          </button>;
        }) : category && groupedTools.map(tool => {
          const Icon = toolIcons[tool.id], count = tasks.filter(task => task.toolId === tool.id).length;
          return <button key={tool.id} className={`category-tool ${tool.id === activeToolId ? 'active' : ''}`} data-tool-id={tool.id} title={tool.name}
            aria-current={tool.id === activeToolId ? 'page' : undefined} onClick={() => { close(true); onChoose(tool.id); }}>
            <span className={`tool-icon category-${category.key}`}><Icon size={18} /></span>
            <span className="category-tool-copy"><strong>{tool.name}</strong><small>{tool.description}</small></span>
            {count > 0 && <span className="category-task-count" aria-label={`${count} 个已打开任务`}>{count}</span>}
          </button>;
        })}
      </nav>
      <footer className="category-panel-footer">{narrow ? `选择${shared ? '栏目' : '工具'}后返回工作区` : '↑ ↓ 选择 · Enter 打开 · Esc 关闭'}</footer>
    </section>}</MotionPresence>
  </div>;
}
