// UI Motion shared primitives. Visual work never schedules business callbacks.
export const reducedMotion = () =>
  typeof window === "undefined" ||
  !window.matchMedia ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const running = new Set<Animation>();
let media: MediaQueryList | undefined;
export function animate(
  element: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions = {},
) {
  if (reducedMotion() || !element.animate || !element.isConnected)
    return undefined;
  if (!media) {
    media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", () => {
      if (media?.matches) for (const animation of running) animation.finish();
    });
  }
  const animation = element.animate(frames, {
    duration: 260,
    easing: "cubic-bezier(.22,1,.36,1)",
    ...options,
  });
  running.add(animation);
  const finish = () => running.delete(animation);
  animation.addEventListener("finish", finish, { once: true });
  animation.addEventListener("cancel", finish, { once: true });
  return animation;
}
export function createSpring(
  initialValue = 0,
  { stiffness = 320, damping = 32, precision = 0.05 } = {},
) {
  let value = initialValue,
    target = value,
    velocity = 0,
    frame = 0,
    previous = 0;
  const listeners = new Set<(value: number, settled: boolean) => void>();
  function tick(now: number) {
    // Substeps keep the solver stable after dropped frames or background throttling.
    let remaining = Math.min((now - previous) / 1000, 0.064);
    previous = now;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120);
      velocity += (-stiffness * (value - target) - damping * velocity) * dt;
      value += velocity * dt;
      remaining -= dt;
    }
    const settled =
      reducedMotion() ||
      (Math.abs(value - target) < precision && Math.abs(velocity) < precision);
    if (settled) {
      value = target;
      velocity = 0;
      frame = 0;
    }
    listeners.forEach((listener) => listener(value, settled));
    if (!settled) frame = requestAnimationFrame(tick);
  }
  return {
    set(next: number, { hard = false } = {}) {
      target = next;
      if (hard || reducedMotion()) {
        cancelAnimationFrame(frame);
        frame = 0;
        value = next;
        velocity = 0;
        listeners.forEach((listener) => listener(value, true));
      } else if (!frame) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    subscribe(listener: (value: number, settled: boolean) => void) {
      listeners.add(listener);
      listener(value, true);
      return () => {
        listeners.delete(listener);
      };
    },
    getValue: () => value,
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      listeners.clear();
    },
  };
}
export function swapText(element: HTMLElement, text: string) {
  // Only use on dedicated, non-React-owned text slots, never editor contents.
  if (element.textContent === text) return;
  const old = element.textContent || "";
  element.textContent = text;
  if (old)
    animate(
      element,
      [
        { opacity: 0.1, transform: "translateY(3px)", filter: "blur(2px)" },
        { opacity: 1, transform: "none", filter: "none" },
      ],
      { duration: 200 },
    );
}
export type LayoutSnapshot = Map<HTMLElement, DOMRect>;
export function measureChildren(
  container: HTMLElement,
  selector = ":scope > [data-motion-key]",
): LayoutSnapshot {
  return new Map(
    [...container.querySelectorAll<HTMLElement>(selector)]
      .slice(0, 100)
      .map((element) => [element, element.getBoundingClientRect()]),
  );
}
const layoutAnimations = new WeakMap<HTMLElement, Animation>();
export function flipChildren(
  container: HTMLElement,
  before: LayoutSnapshot,
  filtering = false,
  track: (animation: Animation, ghost?: HTMLElement) => void = () => {},
) {
  const visual = new Map<HTMLElement, { x: number; y: number }>();
  for (const [element, rect] of before) {
    const motion = layoutAnimations.get(element);
    if (motion && element.isConnected) {
      const transform = getComputedStyle(element).transform;
      const matrix =
        transform === "none" ? null : new DOMMatrixReadOnly(transform);
      visual.set(element, {
        x: rect.x + (matrix?.m41 || 0),
        y: rect.y + (matrix?.m42 || 0),
      });
      motion.cancel();
      layoutAnimations.delete(element);
    }
  }
  const after = measureChildren(container);
  // Search changes are immediate and never replay a whole result set.
  if (filtering) return after;
  if (!reducedMotion() && container.getClientRects().length)
    for (const [element, rect] of after) {
      const old = visual.get(element) || before.get(element);
      let motion: Animation | undefined;
      if (!old)
        motion = animate(
          element,
          [
            { opacity: 0, transform: "translateY(5px) scale(.98)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 200 },
        );
      else if (Math.abs(old.x - rect.x) + Math.abs(old.y - rect.y) > 1)
        motion = animate(
          element,
          [
            { transform: `translate(${old.x - rect.x}px,${old.y - rect.y}px)` },
            { transform: "none" },
          ],
          { duration: 320 },
        );
      if (motion) {
        layoutAnimations.set(element, motion);
        track(motion);
      }
    }
  // Removed cards get a short, inert visual proxy. No handlers, focus or editor
  // instances are duplicated; remaining real cards reflow immediately.
  if (!reducedMotion() && container.getClientRects().length)
    for (const [element, rect] of before) {
      if (
        after.has(element) ||
        element.isConnected ||
        !rect.width ||
        element.querySelector(".cm-editor")
      )
        continue;
      const ghost = element.cloneNode(true) as HTMLElement;
      ghost
        .querySelectorAll("[id]")
        .forEach((node) => node.removeAttribute("id"));
      ghost.removeAttribute("id");
      ghost.inert = true;
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("motion-list-exit");
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        pointerEvents: "none",
        zIndex: "20",
      });
      document.body.append(ghost);
      const exit = animate(
        ghost,
        [
          { opacity: 0.6 },
          { opacity: 0, transform: "translateY(-4px) scale(.97)" },
        ],
        { duration: 160 },
      );
      if (exit) {
        track(exit, ghost);
        exit.finished.then(
          () => ghost.remove(),
          () => ghost.remove(),
        );
      } else ghost.remove();
    }
  return after;
}
let actionSource: HTMLButtonElement | null = null;
export function buttonFeedback() {
  const active =
    typeof document !== "undefined" ? document.activeElement : null;
  const source =
    actionSource ||
    (active instanceof HTMLButtonElement
      ? active
      : active
          ?.closest("form")
          ?.querySelector<HTMLButtonElement>(
            ".run-button:not([type=button]),button[type=submit]",
          ) || null);
  const send = (state: "pending" | "success" | "error") => {
    if (source?.isConnected)
      source.dispatchEvent(new CustomEvent("motion-action", { detail: state }));
  };
  send("pending");
  return (ok: boolean) => send(ok ? "success" : "error");
}
export function fromButton<T>(button: HTMLButtonElement, action: () => T): T {
  const previous = actionSource;
  actionSource = button;
  try {
    return action();
  } finally {
    actionSource = previous;
  }
}
export async function copyText(text: string): Promise<void> {
  const source =
    actionSource ||
    (typeof document !== "undefined" &&
    document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : null);
  let copied = false;
  if (typeof navigator.clipboard?.writeText === 'function') {
    try { await navigator.clipboard.writeText(text); copied = true; } catch { /* Try the user-gesture fallback below. */ }
  }
  if (!copied) {
    const previous = document.activeElement, selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const input = document.createElement('textarea');
    input.value = text; input.readOnly = true; input.tabIndex = -1;
    input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    const dialogs = document.querySelectorAll('dialog[open]');
    (dialogs[dialogs.length - 1] || document.body).appendChild(input);
    try { input.focus({ preventScroll: true }); input.select(); copied = document.execCommand('copy'); } catch { copied = false; }
    finally {
      input.remove(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      if (selection && ranges.every(range => range.commonAncestorContainer.isConnected)) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
    }
  }
  source?.dispatchEvent(new CustomEvent('motion-copy', { detail: copied }));
  if (!copied) {
    window.dispatchEvent(new CustomEvent('devkit:manual-copy', { detail: text }));
    throw new Error('浏览器未允许自动复制，已打开手动复制窗口。');
  }
}
export function textDifference(before: string, after: string) {
  const a = Array.from(before),
    b = Array.from(after);
  let prefix = 0,
    suffix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < Math.min(a.length, b.length) - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  return {
    prefix,
    suffix,
    removed: a.slice(prefix, a.length - suffix),
    added: b.slice(prefix, b.length - suffix),
  };
}
