import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe, ChevronDown, Activity, ScrollText, Coffee, Server, FolderOpen, Send } from 'lucide-react';
import { workspaceModules } from './catalog';
import './shared-navigation.css';

type ModuleId = typeof workspaceModules[number]['id'];
const hints: Record<ModuleId, string> = { http: '接口设计与调试', projects: '项目入口与环境档案', nginx: '配置与实例管理', jar: '应用启停与控制台', monitor: '可用率与故障记录', logs: '实时日志多窗对照' };

export default function SharedWorkspaceNavigation({ page, onChoose }: { page: string; onChoose: (id: ModuleId) => void }) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const selected = workspaceModules.some(item => item.id === page);
  useEffect(() => { setOpen(false); }, [page]);
  function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }); }
  useLayoutEffect(() => {
    const surface = panel.current, anchor = trigger.current;
    if (!open || !surface || !anchor) return;
    surface.showPopover();
    const place = () => {
      const rect = anchor.getBoundingClientRect(), width = Math.min(280, innerWidth - 24);
      Object.assign(surface.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`, top: `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - surface.offsetHeight - 12))}px` });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(surface); window.addEventListener('resize', place);
    (surface.querySelector<HTMLButtonElement>('[aria-current=page]') || surface.querySelector<HTMLButtonElement>('[role=menuitem]'))?.focus({ preventScroll: true });
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [open]);
  return <div className="shared-navigation"><button ref={trigger} className="shared-nav-trigger" aria-label="共享" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'shared-workspace-menu' : undefined} aria-current={selected ? 'page' : undefined} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><Globe size={14} /><span>共享</span><ChevronDown className="shared-nav-chevron" size={12} /></button>
    {open && createPortal(<div ref={panel} id="shared-workspace-menu" className="shared-nav-panel" popover="auto" role="menu" aria-label="共享栏目" onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === 'closed') close(); }} onKeyDown={event => {
      const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]')], index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === 'Tab') {
        event.preventDefault(); const primary = [...trigger.current!.closest('nav')!.querySelectorAll<HTMLButtonElement>('button')], position = primary.indexOf(trigger.current!);
        const next = primary[position + (event.shiftKey ? -1 : 1)] || trigger.current!; close(); next.focus({ preventScroll: true });
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
      }
    }}><header>共享工作台 <small>{workspaceModules.length} 个栏目</small></header>{workspaceModules.map(item => {
      const Icon = item.id === 'logs' ? ScrollText : item.id === 'monitor' ? Activity : item.id === 'jar' ? Coffee : item.id === 'nginx' ? Server : item.id === 'http' ? Send : FolderOpen;
      return <button role="menuitem" key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => { close(true); onChoose(item.id); }}><Icon size={18} /><span><strong>{item.name}</strong><small>{hints[item.id]}</small></span></button>;
    })}</div>, document.body)}
  </div>;
}
