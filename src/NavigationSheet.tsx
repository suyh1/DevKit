import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createSpring } from './motion-primitives';

// Height increases when the handle moves up. Beyond an anchor, each extra
// pixel of drag contributes less travel; even a long drag stays in reach.
export function resistedHeight(height: number, low: number, high: number) {
  const limit = Math.max(low, Math.min(high, height));
  const distance = height - limit;
  return limit + distance / (3 + Math.abs(distance) / 32);
}
export function expandedOnRelease(height: number, velocity: number, low: number, high: number) {
  return height + Math.max(-2, Math.min(2, velocity)) * 170 >= (low + high) / 2;
}

export default function NavigationSheet({ open, close, children }: { open: boolean; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const spring = useRef<ReturnType<typeof createSpring> | null>(null);
  const anchors = useRef({ low: 0, high: 0 });
  const expanded = useRef(false);
  const [full, setFull] = useState(false);
  const drag = useRef<{ id: number; y: number; start: number; lastY: number; lastTime: number; velocity: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  function snap(next: boolean) {
    expanded.current = next;
    setFull(next);
    spring.current?.set(next ? anchors.current.high : anchors.current.low);
  }
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!open || !panel) return;
    panel.showModal();
    const height = createSpring(0, { stiffness: 330, damping: 30 });
    spring.current = height;
    expanded.current = false;
    setFull(false);
    const measure = () => {
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      anchors.current = { low: viewport * .52, high: viewport * .89 };
      height.set(expanded.current ? anchors.current.high : anchors.current.low, { hard: true });
      drag.current = null;
    };
    measure();
    height.subscribe(value => panel.style.height = `${value}px`);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      height.stop();
      spring.current = null;
      drag.current = null;
      suppressClick.current = false;
      panel.close();
    };
  }, [open]);
  function move(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const delta = gesture.y - event.clientY;
    if (Math.abs(delta) > 3) gesture.moved = true;
    const dt = event.timeStamp - gesture.lastTime;
    if (dt > 0 && event.clientY !== gesture.lastY) {
      gesture.velocity = (gesture.lastY - event.clientY) / dt;
      gesture.lastTime = event.timeStamp;
      gesture.lastY = event.clientY;
    }
    const { low, high } = anchors.current;
    spring.current?.set(resistedHeight(gesture.start + delta, low, high), { hard: true });
  }
  function end(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!cancelled) move(event);
    drag.current = null;
    suppressClick.current = gesture.moved;
    const { low, high } = anchors.current;
    const velocity = event.timeStamp - gesture.lastTime > 90 ? 0 : gesture.velocity;
    snap(cancelled || !gesture.moved ? expanded.current : expandedOnRelease(spring.current!.getValue(), velocity, low, high));
  }
  return <dialog className="portal-drawer" ref={dialog} aria-label="共享导航" onCancel={event => { event.preventDefault(); close(); }}>
    <button type="button" className="sheet-handle" aria-label={full ? '收至半屏' : '展开导航面板'} aria-expanded={full}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0 || !spring.current) return;
        suppressClick.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = spring.current.getValue();
        spring.current.set(start, { hard: true });
        drag.current = { id: event.pointerId, y: event.clientY, start, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0, moved: false };
      }}
      onPointerMove={move} onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)}
      onLostPointerCapture={event => end(event, true)}
      onClick={event => { if (!event.detail || !suppressClick.current) snap(!expanded.current); suppressClick.current = false; }}
    ><span /></button>
    {children}
  </dialog>;
}
