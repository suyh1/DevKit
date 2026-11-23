import '@oddbird/popover-polyfill';
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useEffect,
  type DetailsHTMLAttributes,
  type ReactElement,
  type HTMLAttributes,
} from 'react';
import { X } from 'lucide-react';
import './floating-details.css';
import { followSurfaceHost, surfaceHostVisible } from './surface-visibility';

/** Keep the summary in flow and preserve form ownership, including inside another dialog. */
export default function FloatingDetails({
  children,
  className = '',
  onToggle,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const details = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const stopWatching = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopWatching.current?.(), []);
  const id = useId();
  const items = Children.toArray(children);
  const trigger = items.find((item) => isValidElement(item) && item.type === 'summary') as ReactElement<
    HTMLAttributes<HTMLElement>
  >;
  const close = () => {
    const host = details.current;
    if (!host) return;
    host.open = false;
    host.querySelector('summary')?.focus({ preventScroll: true });
  };
  return (
    <details
      {...props}
      className={className + ' floating-details'}
      ref={details}
      onToggle={(event) => {
        if (event.target !== event.currentTarget || !panel.current) return;
        const host = event.currentTarget;
        const visible = panel.current.matches(':popover-open');
        stopWatching.current?.();
        if (host.open && !visible) {
          if (!surfaceHostVisible(host)) { host.open = false; return; }
          if (title.current) title.current.textContent = host.querySelector('summary')?.textContent?.trim() || '详情';
          panel.current.showPopover();
          stopWatching.current = followSurfaceHost(host, active => { if (!active) host.open = false; });
          panel.current.querySelector<HTMLButtonElement>('.floating-details-close')?.focus({ preventScroll: true });
        } else if (!host.open && visible) panel.current.hidePopover();
        onToggle?.(event);
      }}
    >
      {cloneElement(trigger, { 'aria-controls': id, 'aria-haspopup': 'dialog' })}
      <section
        id={id}
        ref={panel}
        className="floating-details-panel"
        popover="auto"
        role="dialog"
        aria-labelledby={id + '-title'}
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !event.defaultPrevented &&
            (event.target as Element).closest('[popover]') === event.currentTarget
          ) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        onToggle={(event) => {
          if (event.target === event.currentTarget && !event.currentTarget.matches(':popover-open') && details.current)
            details.current.open = false;
        }}
      >
        <header className="floating-details-heading">
          <h2 id={id + '-title'} ref={title} />
          <button className="floating-details-close icon-button" type="button" aria-label="关闭详情" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="floating-details-body">{items.filter((item) => item !== trigger)}</div>
      </section>
    </details>
  );
}
