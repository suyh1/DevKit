import '@oddbird/popover-polyfill';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export type HostMenuPosition = { id: string; x?: number; y?: number };

export default function LanHostMenu({ position, label, close, children, anchorElement }: {
  anchorElement?: HTMLElement; position: HostMenuPosition; label: string; close: () => void; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const row = () => anchorElement || panel.current?.closest('li')?.querySelector<HTMLButtonElement>('.lan-connection-select');
  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
  useLayoutEffect(() => {
    const menu = panel.current!, anchor = row()!;
    if (position.x === undefined) anchor.scrollIntoView({ block: 'nearest' });
    menu.showPopover();
    function place() {
      const bounds = anchor.getBoundingClientRect();
      const x = position.x ?? bounds.right, y = position.y ?? bounds.bottom;
      menu.style.left = Math.max(6, Math.min(x, innerWidth - menu.offsetWidth - 6)) + 'px';
      menu.style.top = Math.max(6, Math.min(y, innerHeight - menu.offsetHeight - 6)) + 'px';
    }
    place();
    (items()[0] || menu).focus({ preventScroll: true });
    const resize = new ResizeObserver(place);
    resize.observe(menu);
    window.addEventListener('resize', place);
    return () => { resize.disconnect(); window.removeEventListener('resize', place); };
  }, [position]);
  function dismiss() {
    panel.current?.hidePopover();
    row()?.focus({ preventScroll: true });
    close();
  }
  return <div ref={panel} popover="auto" tabIndex={-1} className="action-popover lan-host-menu"
    onToggle={event => { if (!event.currentTarget.matches(':popover-open')) close(); }}
    onClickCapture={event => {
      if ((event.target as Element).closest('[role="menuitem"]')) row()?.focus({ preventScroll: true });
    }}
    onClick={event => { if ((event.target as Element).closest('[role="menuitem"]:not(:disabled)')) close(); }}
    onKeyDown={event => {
      if (event.key === 'Tab') { dismiss(); return; }
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); return; }
      const buttons = items(), index = buttons.indexOf(document.activeElement as HTMLElement);
      if (!buttons.length) return;
      const positions: Record<string, number> = { Home: 0, End: buttons.length - 1,
        ArrowDown: (index + 1) % buttons.length, ArrowUp: (index - 1 + buttons.length) % buttons.length };
      if (Object.hasOwn(positions, event.key)) { event.preventDefault(); buttons[positions[event.key]].focus(); }
    }} role="menu" aria-label={label}>{children}</div>;
}
