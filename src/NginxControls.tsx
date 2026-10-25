import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function NginxControlDock({ active, children }: { active: boolean; children: (options: { stuck: boolean; compact: boolean; toggle: () => void }) => ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null), dock = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false), [expanded, setExpanded] = useState(false);
  const compact = stuck && !expanded;
  useEffect(() => {
    const root = anchor.current?.closest<HTMLElement>('.nginx-workspace');
    if (!root || !anchor.current || !active) return;
    const observer = new IntersectionObserver(([entry]) => {
      const pinned = !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
      setStuck(pinned); if (!pinned) setExpanded(false);
    }, { root, threshold: [0, 1] });
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    const root = dock.current?.closest<HTMLElement>('.nginx-workspace'), panel = dock.current;
    if (!root || !panel || !active) return;
    const resize = new ResizeObserver(() => root.style.setProperty('--ng-dock-height', `${Math.ceil(panel.getBoundingClientRect().height) + 12}px`));
    resize.observe(panel);
    return () => { resize.disconnect(); root.style.removeProperty('--ng-dock-height'); };
  }, [active]);
  useEffect(() => {
    if (!compact) return;
    dock.current?.querySelectorAll<HTMLButtonElement>('.ng-dock-metadata .ng-help-trigger').forEach(button => {
      const id = button.getAttribute('aria-controls'); if (id) document.getElementById(id)?.hidePopover();
    });
  }, [compact]);
  return <><div className="ng-dock-anchor" ref={anchor} aria-hidden="true" /><div ref={dock} className="ng-control-dock" role="region" aria-label="Nginx 实例操作" data-stuck={stuck} data-compact={compact}>{children({ stuck, compact, toggle: () => setExpanded(value => !value) })}</div></>;
}

export type NginxOutput = { ok: boolean; command: string; output: string };
export function NginxCommandOutput({ output, compact }: { output: NginxOutput; compact: boolean }) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { setExpanded(!compact); }, [compact]);
  useEffect(() => { setExpanded(true); }, [output]);
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className={`ng-output ${output.ok ? 'success' : 'failure'}`}><summary>{output.ok ? '命令执行成功' : '命令未完成'}<small>{expanded ? '收起执行详情' : '展开执行详情'}</small></summary><div className="ng-output-body"><code>{output.command}</code><pre>{output.output || '无输出'}</pre></div></details>;
}
