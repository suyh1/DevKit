import { useEffect, useRef, useState } from 'react';
import { Search, ArrowUp, ArrowDown, CornerDownLeft, X, SearchX } from 'lucide-react';
import type { ToolId } from './tools';
import { toolIcons, categoryMeta } from './ui';
import { searchTools } from './discovery';

export default function CommandPalette({ open, onClose, onChoose, favorites, recent }: { open: boolean; onClose: () => void; onChoose: (id: ToolId, fresh?: boolean) => void; favorites: ToolId[]; recent: ToolId[] }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0);
  const matches = searchTools(query, favorites, recent);
  const visible = matches;
  useEffect(() => {
    const element = dialog.current;
    if (open) { setQuery(''); setIndex(0); if (element && !element.open) element.showModal(); input.current?.focus(); }
    else if (element?.open) element.close();
  }, [open]);
  useEffect(() => { if (dialog.current?.open) results.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [index, query]);
  function choose(id: ToolId, fresh = false) { onClose(); onChoose(id, fresh); }
  return <dialog ref={dialog} className="command-dialog" aria-label="搜索工具" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="command-search"><Search size={21} /><input ref={input} aria-label="搜索全部工具" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={visible[index] ? `command-${visible[index].id}` : undefined} autoComplete="off" placeholder="搜索工具、颜色或转换功能…" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(old => Math.max(0, Math.min(old + 1, visible.length - 1))); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(old => Math.max(old - 1, 0)); }
      if (event.key === 'Enter' && visible[index]) { event.preventDefault(); choose(visible[index].id, event.shiftKey); }
    }} /><button className="icon-button" aria-label="关闭搜索" onClick={onClose}><X size={17} /></button></div>
    <div className="command-section-label">{query ? `找到 ${matches.length} 个工具` : '快速打开 · 收藏与最近使用优先'} · Shift + Enter 新建任务</div>
    <div ref={results} className="command-results" id="command-results" role="listbox" aria-label="工具搜索结果">{visible.length ? visible.map((tool, position) => { const Icon = toolIcons[tool.id]; return <button key={tool.id} id={`command-${tool.id}`} role="option" aria-selected={index === position} className={`command-result ${index === position ? 'selected' : ''}`} onMouseMove={() => setIndex(position)} onClick={() => choose(tool.id)}><span className={`tool-icon category-${categoryMeta[tool.category].key}`}><Icon size={19} /></span><span><strong>{tool.name}</strong><small>{tool.english}</small></span><span className="command-category">{tool.category}</span><CornerDownLeft size={15} /></button>; }) : <div className="command-empty"><SearchX size={30} /><strong>暂时没有匹配的工具</strong><span>试试“JSON”“颜色”或“编码”。</span></div>}</div>
    <div className="command-footer"><span><ArrowUp size={12} /><ArrowDown size={12} />选择</span><span><CornerDownLeft size={12} />打开工具</span><span><kbd>Esc</kbd>关闭</span><small>所有工具都在本地运行</small></div>
  </dialog>;
}
