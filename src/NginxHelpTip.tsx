import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function NginxHelpTip({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  const generatedId = useId(), contentId = id || generatedId;
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(trigger.current?.closest('dialog') || document.body); }, []);
  const clear = () => { clearTimeout(timer.current); };
  const hide = () => { clear(); pinned.current = false; popup.current?.hidePopover(); setOpen(false); };
  function place() {
    const button = trigger.current?.getBoundingClientRect(), panel = popup.current;
    if (!button || !panel) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(button.left, innerWidth - rect.width - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(button.bottom + 8 + rect.height <= innerHeight - 12 ? button.bottom + 8 : button.top - rect.height - 8, innerHeight - rect.height - 12))}px`;
  }
  function show() {
    clear();
    if (!popup.current?.matches(':popover-open')) popup.current?.showPopover();
    place(); setOpen(true);
  }
  function leave() {
    clear();
    timer.current = setTimeout(() => {
      if (!pinned.current && document.activeElement !== trigger.current) hide();
    }, 150);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); } };
    const move = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) place(); };
    window.addEventListener('keydown', escape, true); window.addEventListener('resize', move); window.addEventListener('scroll', move, true);
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', move); window.removeEventListener('scroll', move, true); };
  }, [open]);
  return <><button ref={trigger} type="button" className="ng-help-trigger" aria-label={`查看${label}说明`} aria-expanded={open} aria-controls={contentId} aria-describedby={contentId}
    onPointerEnter={show} onPointerLeave={leave} onFocus={show} onBlur={() => { if (!pinned.current) hide(); }}
    onClick={event => { event.preventDefault(); event.stopPropagation(); if (pinned.current) hide(); else { show(); pinned.current = true; } }}><span aria-hidden="true">?</span></button>
    {host && createPortal(<div ref={popup} id={contentId} popover="auto" className="ng-help-popover" role="tooltip" onPointerEnter={clear} onPointerLeave={leave} onToggle={() => { const visible = !!popup.current?.matches(':popover-open'); setOpen(visible); if (!visible) pinned.current = false; }}><strong>{label}</strong><div>{children}</div><small>点击外部或按 Esc 关闭</small></div>, host)}</>;
}
