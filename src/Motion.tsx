import {
  Children,
  createElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
} from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  RefObject,
} from "react";
import {
  animate,
  createSpring,
  flipChildren,
  fromButton,
  measureChildren,
  reducedMotion,
  swapText,
  textDifference,
} from "./motion-primitives";
import type { LayoutSnapshot } from "./motion-primitives";

export function MotionPresence({
  present,
  children,
  kind = "panel",
}: {
  present: boolean;
  children: ReactNode;
  kind?: "panel" | "dialog" | "popover" | "toast" | "drawer";
}) {
  const [mounted, setMounted] = useState(present),
    last = useRef(children),
    host = useRef<HTMLDivElement>(null),
    generation = useRef(0);
  if (present) last.current = children;
  useLayoutEffect(() => {
    const ticket = ++generation.current;
    if (present) {
      const target = host.current?.querySelector<HTMLElement>(":scope > *");
      if (target) target.inert = false;
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const element = host.current,
      target = element?.querySelector<HTMLElement>(":scope > *");
    if (element) element.inert = true;
    if (target) target.inert = true; // Modal top-layer elements escape ancestor inertness.
    const end = () => {
      if (ticket === generation.current) {
        last.current = null;
        setMounted(false);
      }
    };
    if (reducedMotion()) {
      end();
      return;
    }
    // Keep the real subtree (and native modal top layer) alive until its exit ends.
    const animation = target
      ? animate(
          target,
          [
            { opacity: getComputedStyle(target).opacity },
            {
              opacity: 0,
              translate: "0 4px",
              scale: kind === "dialog" ? ".98" : "1",
            },
          ],
          { duration: 160, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" },
        )
      : undefined;
    if (!animation) {
      end();
      return;
    }
    animation.finished.then(end, end);
    return () => {
      generation.current++;
      animation.cancel();
      if (target) target.inert = false;
    };
  }, [present, mounted, kind]);
  if (!present && !mounted) return null;
  return (
    <div
      className={`motion-presence motion-presence-${kind}`}
      data-state={present ? "open" : "closing"}
      ref={host}
      inert={!present}
      onAnimationEnd={(event) => {
        if (!present && event.target === event.currentTarget) setMounted(false);
      }}
    >
      {present ? children : last.current}
    </div>
  );
}

export function MotionText({ text }: { text: string }) {
  const root = useRef<HTMLSpanElement>(null),
    ghosts = useRef<HTMLSpanElement>(null),
    old = useRef(text);
  const positions = useRef<{ char: string; left: number; top: number }[]>([]);
  useLayoutEffect(() => {
    const element = root.current,
      difference = textDifference(old.current, text);
    old.current = text;
    if (!element || text.length > 160) return;
    const glyphs = [
      ...element.querySelectorAll<HTMLElement>(
        ":scope > .motion-text-current > span",
      ),
    ];
    const animations: Animation[] = [];
    if (!reducedMotion()) {
      positions.current
        .slice(difference.prefix, positions.current.length - difference.suffix)
        .forEach((position) => {
          const ghost = document.createElement("span");
          swapText(ghost, position.char);
          ghost.style.cssText = `position:absolute;left:${position.left}px;top:${position.top}px;pointer-events:none`;
          ghosts.current?.append(ghost);
          const exit = animate(
            ghost,
            [
              { opacity: 1 },
              {
                opacity: 0,
                transform: "translateY(-6px)",
                filter: "blur(2px)",
              },
            ],
            { duration: 160 },
          );
          if (exit) {
            animations.push(exit);
            exit.finished.then(
              () => ghost.remove(),
              () => ghost.remove(),
            );
          } else ghost.remove();
        });
      if (difference.added.length)
        glyphs
          .slice(difference.prefix, glyphs.length - difference.suffix)
          .forEach((glyph, index) => {
            const entry = animate(
              glyph,
              [
                {
                  opacity: 0,
                  transform: "translateY(7px)",
                  filter: "blur(2.5px)",
                },
                { opacity: 1, transform: "none", filter: "none" },
              ],
              { duration: 240, delay: Math.min(index * 18, 100) },
            );
            if (entry) animations.push(entry);
          });
    }
    positions.current = glyphs.map((glyph) => ({
      char: glyph.textContent || "",
      left: glyph.offsetLeft,
      top: glyph.offsetTop,
    }));
    return () => {
      animations.forEach((animation) => animation.cancel());
      ghosts.current?.replaceChildren();
    };
  }, [text]);
  return (
    <span className="motion-text" ref={root}>
      <span className="motion-text-current">
        {text.length > 160
          ? text
          : Array.from(text).map((char, i) => <span key={i}>{char}</span>)}
      </span>
      <span className="motion-text-ghosts" aria-hidden="true" ref={ghosts} />
    </span>
  );
}
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  outcome?: "success" | "error" | "";
  variant?: "copy" | "action";
  trackBusy?: boolean;
};
function labelText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child) &&
            typeof child.type === "string" &&
            child.type !== "kbd" &&
            child.type !== "svg"
          ? labelText(child.props.children)
          : "",
    )
    .join("");
}
export const MotionButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function MotionButton(
    {
      children,
      className = "",
      busy = false,
      outcome = "",
      variant = "action",
      trackBusy = false,
      onClick,
      ...props
    },
    forwarded,
  ) {
    const ref = useRef<HTMLButtonElement>(null),
      [feedback, setFeedback] = useState<
        "idle" | "pending" | "success" | "error"
      >("idle");
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
      pressed = useRef(false),
      wasBusy = useRef(false);
    const text = labelText(children);
    const labelSlot = useRef<HTMLSpanElement>(null),
      widest = useRef(0);
    useLayoutEffect(() => {
      const slot = labelSlot.current;
      if (!slot) return;
      const measure = () => {
        widest.current = Math.max(
          widest.current,
          slot
            .querySelector<HTMLElement>(".motion-label-measure")
            ?.getBoundingClientRect().width || 0,
        );
        slot.style.minWidth = `${widest.current}px`;
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(slot);
      return () => observer.disconnect();
    }, [text]);
    useEffect(() => {
      if (
        busy &&
        (trackBusy ||
          pressed.current ||
          (ref.current?.form && ref.current.type === "submit"))
      ) {
        wasBusy.current = true;
        setFeedback("pending");
      } else if (wasBusy.current) {
        wasBusy.current = false;
        pressed.current = false;
        setFeedback(outcome || "idle");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setFeedback("idle"), 2400);
      }
    }, [busy, outcome, trackBusy]);
    useEffect(() => {
      const button = ref.current;
      if (!button) return;
      const copied = (event: Event) => {
        clearTimeout(timer.current);
        setFeedback(
          (event as CustomEvent<boolean>).detail ? "success" : "error",
        );
        timer.current = setTimeout(() => setFeedback("idle"), 1900);
      };
      const action = (event: Event) => {
        clearTimeout(timer.current);
        const state = (event as CustomEvent<"pending" | "success" | "error">)
          .detail;
        wasBusy.current = false;
        pressed.current = false;
        setFeedback(state);
        if (state !== "pending")
          timer.current = setTimeout(() => setFeedback("idle"), 2400);
      };
      button.addEventListener("motion-copy", copied);
      button.addEventListener("motion-action", action);
      return () => {
        button.removeEventListener("motion-copy", copied);
        button.removeEventListener("motion-action", action);
        clearTimeout(timer.current);
      };
    }, []);
    const isCopy = variant === "copy",
      label =
        isCopy && text.length > 1
          ? feedback === "success"
            ? "已复制"
            : feedback === "error"
              ? "复制失败"
              : text
          : text;
    const content = Children.toArray(children),
      hasIcon = content.some(
        (child) => isValidElement(child) && typeof child.type !== "string",
      );
    const rich =
      content.some(
        (child) =>
          isValidElement(child) &&
          ["code", "strong", "small"].includes(String(child.type)),
      ) || /color-swatch/.test(className);
    const symbolCopy = isCopy && !rich && !hasIcon && text.length === 1;
    return (
      <button
        {...props}
        className={`${className} motion-button`}
        data-motion-feedback={feedback}
        data-copy={isCopy || undefined}
        aria-label={props["aria-label"] || text || undefined}
        ref={(element) => {
          ref.current = element;
          if (typeof forwarded === "function") forwarded(element);
          else if (forwarded) forwarded.current = element;
        }}
        onClick={(event) => {
          pressed.current = true;
          fromButton(event.currentTarget, () => onClick?.(event));
        }}
      >
        {rich ? (
          <>
            {children}
            <span className="motion-rich-check" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path d="m5 12 4 4 10-10" pathLength="24" />
              </svg>
            </span>
          </>
        ) : (
          <>
            {(hasIcon || symbolCopy) && (
              <span className="motion-glyph-slot">
                <span className="motion-original-glyph">
                  {symbolCopy
                    ? text
                    : content.filter(
                        (child) =>
                          isValidElement(child) &&
                          typeof child.type !== "string",
                      )}
                </span>
                <svg
                  className="motion-pending-glyph"
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="8" />
                </svg>
                <svg
                  className="motion-check"
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                >
                  <path d="m5 12 4 4 10-10" pathLength="24" />
                </svg>
                <svg
                  className="motion-error-glyph"
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                >
                  <path d="m6 6 12 12M6 18 18 6" />
                </svg>
              </span>
            )}
            {text && !symbolCopy ? (
              <span className="motion-label-slot" ref={labelSlot}>
                <span className="motion-label-measure" aria-hidden="true">
                  {isCopy && text.length > 1
                    ? [text, "复制失败"].sort((a, b) => b.length - a.length)[0]
                    : text}
                </span>
                <MotionText text={label} />
              </span>
            ) : null}
            {content.filter(
              (child) => isValidElement(child) && child.type === "kbd",
            )}
          </>
        )}
      </button>
    );
  },
);

export function MotionGroup({
  as = "div",
  children,
  className = "",
  groupRef,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "nav";
  children: ReactNode;
  groupRef?: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLElement>(null),
    pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const group = ref.current,
      layer = pill.current;
    if (!group || !layer) return;
    let initialized = false,
      frame = 0,
      selected: HTMLElement | null = null;
    const x = createSpring(),
      y = createSpring(),
      width = createSpring(),
      height = createSpring();
    const draw = () => {
      layer.style.transform = `translate3d(${x.getValue()}px,${y.getValue()}px,0)`;
      layer.style.width = `${Math.max(0, width.getValue())}px`;
      layer.style.height = `${Math.max(0, height.getValue())}px`;
    };
    const subscriptions = [x, y, width, height].map((spring) =>
      spring.subscribe(draw),
    );
    function update() {
      if (!group || !layer || !group.getClientRects().length) return;
      const active = group.querySelector<HTMLElement>(
        ":scope > button[aria-pressed=true], :scope > button[aria-current=page], :scope > .task-tab.selected, :scope > button[aria-selected=true], :scope > button.selected, :scope > button.is-active",
      );
      if (!active) {
        layer.style.opacity = "0";
        return;
      }
      const changed = selected !== active;
      selected = active;
      const hard = !initialized;
      layer.style.opacity = "1";
      // Offset geometry excludes FLIP transforms on task tabs during reordering.
      x.set(active.offsetLeft, { hard });
      y.set(active.offsetTop, { hard });
      width.set(active.offsetWidth, { hard });
      height.set(active.offsetHeight, { hard });
      initialized = true;
      if (
        changed &&
        group.scrollWidth > group.clientWidth &&
        (active.offsetLeft < group.scrollLeft ||
          active.offsetLeft + active.offsetWidth >
            group.scrollLeft + group.clientWidth)
      )
        group.scrollTo({
          left: Math.max(0, active.offsetLeft - 20),
          behavior: reducedMotion() ? "instant" : "smooth",
        });
      group.dataset.fadeStart = String(group.scrollLeft > 1);
      group.dataset.fadeEnd = String(
        group.scrollWidth - group.clientWidth - group.scrollLeft > 1,
      );
    }
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.target !== layer && !layer!.contains(record.target),
        )
      ) {
        observeChildren();
        schedule();
      }
    });
    observer.observe(group, {
      attributes: true,
      attributeFilter: [
        "aria-pressed",
        "aria-current",
        "aria-selected",
        "class",
        "hidden",
      ],
      childList: true,
      subtree: true,
    });
    const resize = new ResizeObserver(schedule);
    const observed = new Set<Element>();
    function observeChildren() {
      for (const child of observed)
        if (child.parentElement !== group) {
          resize.unobserve(child);
          observed.delete(child);
        }
      for (const child of group!.children)
        if (child !== layer && !observed.has(child)) {
          resize.observe(child);
          observed.add(child);
        }
    }
    resize.observe(group);
    observeChildren();
    const visibility = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) schedule();
    });
    visibility.observe(group);
    group.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => {
      observer.disconnect();
      resize.disconnect();
      visibility.disconnect();
      group.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
      subscriptions.forEach((stop) => stop());
      [x, y, width, height].forEach((spring) => spring.stop());
    };
  }, []);
  return createElement(
    as,
    {
      ...props,
      className: `${className} motion-group`,
      ref: (element: HTMLElement | null) => {
        ref.current = element;
        if (groupRef) groupRef.current = element as HTMLDivElement | null;
      },
    },
    <span className="motion-pill" aria-hidden="true" ref={pill} />,
    children,
  );
}

// Measure after the current React update; only the visual box interpolates.
export function useMotionHeight(
  ref: RefObject<HTMLElement | null>,
  identity: unknown,
) {
  const height = useRef<number | undefined>(undefined),
    animation = useRef<Animation | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !element.getClientRects().length) return;
    const from = element.getBoundingClientRect().height;
    const moving = animation.current?.playState === "running";
    animation.current?.cancel();
    const next = element.offsetHeight;
    if (height.current !== undefined && Math.abs(height.current - next) > 1)
      animation.current = animate(
        element,
        [
          { height: `${moving ? from : height.current}px` },
          { height: `${next}px` },
        ],
        { duration: 300 },
      );
    height.current = next;
  }, [ref, identity]);
  useEffect(() => () => animation.current?.cancel(), []);
}

export function useSkeletonMorph(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
) {
  const placeholder = useRef<{ node: HTMLElement; rect: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!ready) {
      const capture = () => {
        const skeleton =
          element.querySelector<HTMLElement>(".loading-skeleton");
        if (skeleton)
          placeholder.current = {
            node: skeleton.cloneNode(true) as HTMLElement,
            rect: skeleton.getBoundingClientRect(),
          };
      };
      capture();
      const resize = new ResizeObserver(capture);
      resize.observe(element);
      return () => resize.disconnect();
    }
    const old = placeholder.current;
    placeholder.current = null;
    if (!old || reducedMotion() || !element.getClientRects().length) return;
    const rect = element.getBoundingClientRect(),
      ghost = old.node;
    ghost.inert = true;
    ghost.setAttribute("aria-hidden", "true");
    ghost.removeAttribute("role");
    ghost.removeAttribute("aria-busy");
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${old.rect.left}px`,
      top: `${old.rect.top}px`,
      width: `${old.rect.width}px`,
      height: `${old.rect.height}px`,
      margin: "0",
      pointerEvents: "none",
      zIndex: "2",
      transformOrigin: "left top",
    });
    document.body.append(ghost);
    const animation = animate(
      ghost,
      [
        { opacity: 1 },
        {
          opacity: 0,
          transform: `translate(${rect.left - old.rect.left}px,${rect.top - old.rect.top}px) scale(${rect.width / Math.max(1, old.rect.width)},${Math.min(rect.height, window.innerHeight) / Math.max(1, old.rect.height)})`,
        },
      ],
      { duration: 400 },
    );
    if (animation)
      animation.finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
    else ghost.remove();
    return () => {
      animation?.cancel();
      ghost.remove();
    };
  }, [ref, ready]);
}

export function useMotionList(
  ref: RefObject<HTMLElement | null>,
  signature: unknown,
  filtering = false,
) {
  const previous = useRef<LayoutSnapshot>(new Map()),
    initialized = useRef(false),
    pending = useRef(new Map<Animation, HTMLElement | undefined>());
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    previous.current = flipChildren(
      element,
      previous.current,
      filtering || !initialized.current,
      (animation, ghost) => {
        pending.current.set(animation, ghost);
        animation.finished.then(
          () => pending.current.delete(animation),
          () => pending.current.delete(animation),
        );
      },
    );
    initialized.current = true;
  }, [ref, signature, filtering]);
  useEffect(
    () => () => {
      for (const [animation, ghost] of pending.current) {
        animation.cancel();
        ghost?.remove();
      }
      pending.current.clear();
    },
    [],
  );
  useEffect(() => {
    const scrolled = (event: Event) => {
      const element = ref.current;
      if (
        !element ||
        !element.getClientRects().length ||
        (event.target instanceof Node &&
          !event.target.contains(element) &&
          !element.contains(event.target))
      )
        return;
      for (const animation of pending.current.keys()) animation.finish();
      previous.current = measureChildren(element);
    };
    window.addEventListener("scroll", scrolled, {
      capture: true,
      passive: true,
    });
    return () => window.removeEventListener("scroll", scrolled, true);
  }, [ref]);
}

export function MotionReveal({
  children,
  className = "",
  identity,
}: {
  children: ReactNode;
  className?: string;
  identity?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null),
    inner = useRef<HTMLDivElement>(null),
    previousHeight = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(() => {
      const height = inner.current?.getBoundingClientRect().height || 0,
        before = previousHeight.current;
      previousHeight.current = height;
      if (before !== undefined && Math.abs(before - height) > 1) {
        const current = element.getBoundingClientRect().height;
        element.getAnimations().forEach((animation) => animation.cancel());
        animate(
          element,
          [{ height: `${current}px` }, { height: `${height}px` }],
          { duration: 300 },
        );
      }
    });
    if (inner.current) resize.observe(inner.current);
    return () => {
      resize.disconnect();
      element.getAnimations().forEach((animation) => animation.cancel());
    };
  }, []);
  useLayoutEffect(() => {
    const animation = ref.current
      ? animate(ref.current, [{ opacity: 0.3 }, { opacity: 1 }], {
          duration: 180,
        })
      : undefined;
    return () => animation?.cancel();
  }, [identity]);
  return (
    <div className={`motion-reveal ${className}`} ref={ref}>
      <div className="motion-reveal-inner" ref={inner}>
        {children}
      </div>
    </div>
  );
}

export function MotionDrop({ active }: { active: boolean }) {
  return (
    <div className="motion-drop" data-active={active} aria-hidden="true">
      <svg className="motion-drop-edge">
        <rect x="2" y="2" width="100%" height="100%" rx="12" />
      </svg>
      <span className="motion-drop-sheets">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

export function MotionToast({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const gesture = useRef({ x: 0, time: 0, pointer: -1 }),
    ref = useRef<HTMLDivElement>(null);
  useMotionHeight(ref, children);
  return (
    <div
      className="app-toast motion-toast"
      role="status"
      ref={ref}
      onPointerDown={(event) => {
        if ((event.target as Element).closest("button") || event.button !== 0)
          return;
        gesture.current = {
          x: event.clientX,
          time: performance.now(),
          pointer: event.pointerId,
        };
        event.currentTarget.dataset.dragging = "true";
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (gesture.current.pointer === event.pointerId && !reducedMotion())
          event.currentTarget.style.setProperty(
            "--toast-drag",
            `${event.clientX - gesture.current.x}px`,
          );
      }}
      onPointerUp={(event) => {
        if (gesture.current.pointer !== event.pointerId) return;
        const delta = event.clientX - gesture.current.x,
          velocity =
            (Math.abs(delta) /
              Math.max(1, performance.now() - gesture.current.time)) *
            1000;
        gesture.current.pointer = -1;
        delete event.currentTarget.dataset.dragging;
        event.currentTarget.style.removeProperty("--toast-drag");
        if (Math.abs(delta) > 80 || velocity > 480) onClose();
      }}
      onPointerCancel={() => {
        gesture.current.pointer = -1;
        if (ref.current) delete ref.current.dataset.dragging;
        ref.current?.style.removeProperty("--toast-drag");
      }}
    >
      {children}
    </div>
  );
}

// Native details retain their real content during collapse. No subtree cloning.
export function MotionDetails({
  children,
  className = "",
  ...props
}: React.DetailsHTMLAttributes<HTMLDetailsElement>) {
  const ref = useRef<HTMLDetailsElement>(null),
    animation = useRef<Animation | undefined>(undefined),
    intent = useRef<boolean | null>(null);
  useEffect(() => () => animation.current?.cancel(), []);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || props.open === undefined || props.open === intent.current)
      return;
    animation.current?.cancel();
    animation.current = undefined;
    intent.current = null;
    delete element.dataset.motionExpanding;
    for (const child of element.children)
      if (child instanceof HTMLElement && child.tagName !== "SUMMARY")
        child.inert = !props.open;
  }, [props.open]);
  return (
    <details
      {...props}
      className={`${className} motion-details`}
      ref={ref}
      onToggle={(event) => {
        if (intent.current === null)
          for (const child of event.currentTarget.children)
            if (child instanceof HTMLElement && child.tagName !== "SUMMARY")
              child.inert = !event.currentTarget.open;
        props.onToggle?.(event);
      }}
      onClick={(event) => {
        props.onClick?.(event);
        const target = (event.target as Element).closest("summary");
        if (
          event.defaultPrevented ||
          !target ||
          target.parentElement !== ref.current ||
          (event.target as Element).closest("button,input,select,a") ||
          reducedMotion()
        )
          return;
        event.preventDefault();
        const element = ref.current!,
          summary = element.querySelector("summary")!;
        const before = element.getBoundingClientRect().height,
          opening = !(intent.current ?? element.open);
        intent.current = opening;
        animation.current?.cancel();
        element.open = true;
        const styles = getComputedStyle(element),
          borders =
            parseFloat(styles.borderTopWidth || "0") +
            parseFloat(styles.borderBottomWidth || "0");
        if (
          !opening &&
          element.contains(document.activeElement) &&
          document.activeElement !== summary
        )
          summary.focus({ preventScroll: true });
        for (const child of element.children)
          if (child instanceof HTMLElement && child.tagName !== "SUMMARY")
            child.inert = !opening;
        const height = opening
          ? element.scrollHeight + borders
          : summary.getBoundingClientRect().height +
            borders +
            parseFloat(styles.paddingTop || "0") +
            parseFloat(styles.paddingBottom || "0");
        const motion = animate(
          element,
          [{ height: `${before}px` }, { height: `${height}px` }],
          { duration: opening ? 400 : 240 },
        );
        animation.current = motion;
        element.dataset.motionExpanding = String(opening);
        const finish = () => {
          if (animation.current !== motion) return;
          element.open = opening;
          intent.current = null;
          animation.current = undefined;
          delete element.dataset.motionExpanding;
        };
        if (motion) motion.finished.then(finish, () => {});
        else finish();
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
          (event.target as Element).tagName !== "SUMMARY"
        )
          return;
        const summaries = [
          ...(ref.current?.parentElement?.querySelectorAll<HTMLElement>(
            ":scope > details > summary",
          ) || []),
        ];
        const index = summaries.indexOf(event.target as HTMLElement);
        if (index < 0 || summaries.length < 2) return;
        event.preventDefault();
        summaries[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? summaries.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  summaries.length) %
                summaries.length
        ]?.focus();
      }}
    >
      {children}
    </details>
  );
}
