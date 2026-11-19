import { MotionDetails } from './Motion';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { NginxReloadState } from './nginx-api';

export function NginxControlDock({ active, children, scrollRoot }: {
  active: boolean; scrollRoot?: HTMLElement | null; children: (stuck: boolean) => ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null), dock = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const root = scrollRoot || anchor.current?.closest<HTMLElement>('.nginx-workspace');
    if (!root || !anchor.current || !active) return;
    const observer = new IntersectionObserver(([entry]) => {
      setStuck(!entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0));
    }, { root, threshold: [0, 1] });
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [active, scrollRoot]);
  useEffect(() => {
    const root = scrollRoot || dock.current?.closest<HTMLElement>('.nginx-workspace'), panel = dock.current;
    if (!root || !panel || !active) return;
    const resize = new ResizeObserver(() => root.style.setProperty('--ng-dock-height', `${Math.ceil(panel.getBoundingClientRect().height) + 12}px`));
    resize.observe(panel);
    return () => { resize.disconnect(); root.style.removeProperty('--ng-dock-height'); };
  }, [active, scrollRoot]);
  return <>
    <div className="ng-dock-anchor" ref={anchor} aria-hidden="true" />
    <div ref={dock} className="ng-control-dock" role="region" aria-label="Nginx 实例操作" data-stuck={stuck}>{children(stuck)}</div>
  </>;
}

export type NginxOutput = { ok: boolean; command: string; output: string; reloadState?: NginxReloadState };
export function NginxCommandOutput({ output }: { output: NginxOutput }) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { setExpanded(true); }, [output]);
  return <MotionDetails open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className={`ng-output ${output.ok ? 'success' : 'failure'}`}><summary>{output.reloadState === 'unconfirmed' ? '已发送重载信号 · 生效待确认' : output.ok ? '命令执行成功' : '命令未完成'}<small>{expanded ? '收起执行详情' : '展开执行详情'}</small></summary><div className="ng-output-body"><code>{output.command}</code><pre>{output.output || '无输出'}</pre></div></MotionDetails>;
}
