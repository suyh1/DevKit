import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export default function ActionPopover({
  label,
  trigger,
  above = false,
  children,
  className,
}: {
  label: string;
  trigger: ReactNode;
  above?: boolean;
  children: ReactNode;
  className: string;
}) {
  const id = useId(),
    anchor = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const button = anchor.current,
      menu = panel.current;
    function place() {
      const rect = button.getBoundingClientRect();
      menu.style.left =
        Math.max(6, Math.min(innerWidth - menu.offsetWidth - 6, rect.right - menu.offsetWidth)) + 'px';
      menu.style.top =
        Math.max(
          6,
          Math.min(
            innerHeight - menu.offsetHeight - 6,
            above ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4,
          ),
        ) + 'px';
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open, above]);
  return (
    <div className={className}>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
      >
        {trigger}
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        className="action-popover"
        role="group"
        aria-label={label}
        onToggle={(event) => setOpen((event.nativeEvent as ToggleEvent).newState === 'open')}
        onClickCapture={(event) => {
          if (event.target instanceof Element && event.target.closest('button')) {
            panel.current?.hidePopover();
            anchor.current?.focus({ preventScroll: true });
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
