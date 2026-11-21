import { MotionReveal, MotionGroup } from './Motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, reducedMotion } from './motion-primitives';
import { Search, ArrowUp, ArrowDown, CornerDownLeft, X, SearchX } from 'lucide-react';
import type { ToolId } from './tools';
import { toolIcons, categoryMeta } from './ui';
import { searchTools } from './discovery';
import { openWorkspaceLink, parseWorkspaceLink, workspaceSearch } from './workspace-links';
import type { WorkspacePage, WorkspaceResult } from './workspace-links';
import { workspaceModuleNav } from './ui';

export default function CommandPalette({ open, onClose, onChoose, favorites = [], recent = [], pages = [] }: { open: boolean; onClose: () => void; onChoose?: (id: ToolId, fresh?: boolean) => void; favorites?: ToolId[]; recent?: ToolId[]; pages?: WorkspacePage[] }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0);
  const [resources, setResources] = useState<WorkspaceResult[]>([]);
  const pageKey = pages.join(',');
  useEffect(() => {
    setResources([]);
    if (!open) return;
    let live = true;
    void workspaceSearch(pages, next => { if (live) setResources(previous => [...previous, ...next]); });
    return () => { live = false; };
  }, [open, pageKey]);
  const matches = onChoose ? searchTools(query, favorites, recent) : [];
  const terms = query.trim().toLowerCase().split(/\s+/);
  const hashAt = query.indexOf('#');
  const pasted = hashAt >= 0 ? parseWorkspaceLink(query.slice(hashAt).trim()) : undefined;
  const shared = pasted && pages.includes(pasted.page) ? [{ ...pasted, label: '打开资源链接', detail: pasted.page }] : resources.filter(item => (query || !item.id) && terms.every(term => `${item.label} ${item.detail} ${item.page}`.toLowerCase().includes(term))).slice(0, 70);
  const total = matches.length + shared.length;
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { if (element.open) element.close(); return; }
    setQuery(''); setIndex(0);
    const trigger = document.activeElement;
    const origin = trigger?.matches('[data-search-capsule]') && !reducedMotion() ? trigger.getBoundingClientRect() : null;
    element.toggleAttribute('data-capsule', !!origin);
    if (!element.open) element.showModal();
    input.current?.focus();
    if (!origin) return;
    const panel = element.getBoundingClientRect();
    const dx = origin.left + origin.width / 2 - panel.left - panel.width / 2;
    const dy = origin.top + origin.height / 2 - panel.top - panel.height / 2;
    // Clip the full-size panel so the type inside never stretches.
    const clip = `inset(calc(50% - ${origin.height / 2}px) calc(50% - ${origin.width / 2}px) round ${origin.height / 2}px)`;
    element.style.setProperty('--capsule-clip', clip);
    element.style.setProperty('--capsule-offset', `${dx}px ${dy}px`);
    const motion = animate(element, [
      { clipPath: clip, translate: `${dx}px ${dy}px` },
      { clipPath: `inset(0px round ${getComputedStyle(element).borderRadius})`, translate: '0px 0px' },
    ], { duration: 360, easing: 'cubic-bezier(.22,.82,.23,1)' });
    return () => motion?.cancel();
  }, [open]);
  useEffect(() => { if (dialog.current?.open) results.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [index, query]);
  function choose(position: number, fresh = false) {
    onClose();
    const match = matches[position], resource = shared[position - matches.length];
    if (match) onChoose?.(match.id, fresh);
    else if (resource) openWorkspaceLink(resource.page, resource.id);
  }
  return <dialog ref={dialog} className="command-dialog motion-native" aria-label={onChoose ? '搜索工具与资源' : '搜索共享资源'} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="command-search"><Search size={21} /><input ref={input} aria-label={onChoose ? '搜索全部工具' : '搜索共享资源'} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={index < total ? `command-${index}` : undefined} autoComplete="off" placeholder={onChoose ? '搜索工具、共享栏目或资源…' : '搜索栏目、实例、接口或监控…'} value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(old => Math.max(0, Math.min(old + 1, total - 1))); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(old => Math.max(old - 1, 0)); }
      if (event.key === 'Enter' && index < total) { event.preventDefault(); choose(index, event.shiftKey); }
    }} /><button className="icon-button" aria-label="关闭搜索" onClick={onClose}><X size={17} /></button></div>
    <div className="command-section-label">{query ? `找到 ${total} 项` : '快速打开'}{matches[index] && ' · Shift + Enter 新建任务'}</div>
    <MotionReveal><MotionGroup groupRef={results} className="command-results" id="command-results" role="listbox" aria-label="搜索结果">
      {!total && <div className="command-empty"><SearchX size={30} /><strong>暂时没有匹配结果</strong></div>}
      {matches.map((tool, position) => { const Icon = toolIcons[tool.id]; return <button key={tool.id} id={`command-${position}`} role="option" tabIndex={-1} onMouseDown={event => event.preventDefault()} aria-selected={index === position} className={`command-result ${index === position ? 'selected' : ''}`} onMouseMove={() => setIndex(position)} onClick={() => choose(position)}><span className={`tool-icon category-${categoryMeta[tool.category].key}`}><Icon size={19} /></span><span><strong>{tool.name}</strong><small>{tool.english}</small></span><span className="command-category">{tool.category}</span><CornerDownLeft size={15} /></button>; })}
      {shared.map((resource, offset) => {
        const position = matches.length + offset, { Icon } = workspaceModuleNav[resource.page];
        return <button key={`${resource.page}/${resource.id || ''}`} id={`command-${position}`} role="option" tabIndex={-1} onMouseDown={event => event.preventDefault()} aria-selected={index === position} className={`command-result ${index === position ? 'selected' : ''}`} onMouseMove={() => setIndex(position)} onClick={() => choose(position)}><span className="tool-icon"><Icon size={19} /></span><span><strong>{resource.label}</strong><small>{resource.detail}</small></span><CornerDownLeft size={15} /></button>;
      })}
    </MotionGroup></MotionReveal>
    <div className="command-footer"><span><ArrowUp size={12} /><ArrowDown size={12} />选择</span><span><CornerDownLeft size={12} />打开</span><span><kbd>Esc</kbd>关闭</span></div>
  </dialog>;
}
