import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Info, Undo2, X } from 'lucide-react';
import { MotionToast } from './Motion';

export type NoticeKind = 'success' | 'error' | 'info';
export type Notify = (message: string, kind?: NoticeKind) => void;
export type Notice = { kind: NoticeKind; id: number; message: string; undo?: () => void };

function Item({ item, paused, dismiss }: { item: Notice; paused: boolean; dismiss: (id: number) => void }) {
  const remaining = useRef(item.undo ? 12000 : 6000);
  const close = useRef(dismiss);
  close.current = dismiss;
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => close.current(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - start;
    };
  }, [paused, item.id]);
  const Icon = { success: Check, error: CircleAlert, info: Info }[item.kind];
  return (
    <MotionToast onClose={() => dismiss(item.id)}>
      <Icon size={16} aria-hidden="true" data-notice-kind={item.kind} />
      <span>{item.message}</span>
      {item.undo && (
        <button
          onClick={() => {
            dismiss(item.id);
            item.undo?.();
          }}
        >
          <Undo2 size={14} />
          撤销
        </button>
      )}
      <button aria-label="关闭通知" onClick={() => dismiss(item.id)}>
        <X size={14} />
      </button>
    </MotionToast>
  );
}

export function ToastStack({ items, dismiss }: { items: Notice[]; dismiss: (id: number) => void }) {
  const [hover, setHover] = useState(false),
    [focus, setFocus] = useState(false),
    [expanded, setExpanded] = useState(false);
  const open = expanded || hover || focus;
  useEffect(() => {
    if (!items.length) {
      setExpanded(false);
      setHover(false);
      setFocus(false);
    }
  }, [items.length]);
  if (!items.length) return null;
  return (
    <section
      className="notice-stack"
      aria-label="通知"
      onPointerEnter={(event) => setHover(event.pointerType === 'mouse')}
      onPointerLeave={() => setHover(false)}
      onFocus={(event) => setFocus(event.target.matches(':focus-visible'))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false);
      }}
    >
      {items.length > 1 && (
        <button className="notice-count" aria-expanded={open} onClick={() => setExpanded(!expanded)}>
          {items.length} 条通知
        </button>
      )}
      {[...items].reverse().map((item, index) => (
        <div key={item.id} hidden={!open && index > 0}>
          <Item item={item} dismiss={dismiss} paused={open} />
        </div>
      ))}
    </section>
  );
}
