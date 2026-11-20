import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, ChevronDown, ListOrdered } from 'lucide-react';
import type { WorkspaceModule, WorkspaceModuleId } from './catalog';
import { workspaceModuleNav } from './ui';
import './shared-navigation.css';

export default function SharedWorkspaceNavigation({ page, onChoose, modules, onEditOrder }: {
  page: string;
  onChoose: (id: WorkspaceModuleId) => void;
  modules: WorkspaceModule[];
  onEditOrder: (trigger: HTMLButtonElement) => void;
}) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const selected = modules.some(item => item.id === page);
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
    (surface.querySelector<HTMLButtonElement>('[aria-current=page]') || surface.querySelector<HTMLButtonElement>('.shared-nav-item'))?.focus({ preventScroll: true });
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [open]);
  return <div className="shared-navigation"><nav className="shared-shortcuts" aria-label="常用共享栏目">{modules.filter((item, index) => index < 3 || item.id === page).map(item => { const { Icon } = workspaceModuleNav[item.id]; return <button key={item.id} aria-label={item.name} title={item.name} aria-current={page === item.id ? 'page' : undefined} onClick={() => onChoose(item.id)}><Icon size={15} />{page === item.id && <span>{item.name}</span>}</button>; })}</nav><button ref={trigger} className="shared-nav-trigger" aria-label="共享栏目" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'shared-workspace-menu' : undefined} aria-current={selected ? 'page' : undefined} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}><LayoutGrid size={14} /><span>共享栏目</span><ChevronDown className="shared-nav-chevron" size={12} /></button>
    {open && createPortal(<div ref={panel} id="shared-workspace-menu" className="shared-nav-panel" popover="auto" role="menu" aria-label="共享栏目" onToggle={event => { if ((event.nativeEvent as ToggleEvent).newState === 'closed') close(); }} onKeyDown={event => {
      const items = [...panel.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]')], index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === 'Tab') {
        event.preventDefault(); const primary = [...trigger.current!.closest('header')!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], position = primary.indexOf(trigger.current!);
        const next = primary[position + (event.shiftKey ? -1 : 1)] || trigger.current!; close(); next.focus({ preventScroll: true });
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
      }
    }}><header><span>共享栏目</span><button className="shared-sort-action" role="menuitem" aria-haspopup="dialog" onClick={() => {
      const anchor = trigger.current;
      if (anchor) { close(); onEditOrder(anchor); }
    }}><ListOrdered size={16} />排序</button></header>{modules.map(item => {
      const { Icon, hint } = workspaceModuleNav[item.id];
      return <button className="shared-nav-item" role="menuitem" key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => { close(true); onChoose(item.id); }}><Icon size={16} /><span><strong>{item.name}</strong><small>{hint}</small></span></button>;
    })}</div>, document.body)}
  </div>;
}
