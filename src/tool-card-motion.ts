import { flushSync } from 'react-dom';
import { useEffect, type RefObject } from 'react';
import { reducedMotion } from './motion-primitives';

// Only the card under the primary pointer owns a highlight. Native touch
// scrolling, the open button and the footer actions keep their normal events.
export function useCardLight(grid: RefObject<HTMLDivElement | null>, visible: boolean, selector = '.tool-card') {
  useEffect(() => {
    const host = grid.current;
    if (!host || !visible) return;
    let active: HTMLElement | null = null;
    function reset() {
      if (active) {
        delete active.dataset.lit;
        for (const name of ['--tilt-x', '--tilt-y', '--light-x', '--light-y']) active.style.removeProperty(name);
        active = null;
      }
    }
    function track(event: PointerEvent) {
      if (!event.isPrimary || reducedMotion()) return reset();
      const card = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
      if (active !== card) reset();
      if (!card) return;
      active = card;
      const rect = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      card.style.setProperty('--tilt-x', `${(0.5 - y) * 7}deg`);
      card.style.setProperty('--tilt-y', `${(x - 0.5) * 7}deg`);
      card.style.setProperty('--light-x', `${x * 100}%`);
      card.style.setProperty('--light-y', `${y * 100}%`);
      card.dataset.lit = '';
    }
    host.addEventListener('pointermove', track);
    host.addEventListener('pointerdown', track);
    const ends = ['pointerleave', 'pointercancel', 'pointerup'] as const;
    ends.forEach(type => host.addEventListener(type, reset));
    return () => {
      host.removeEventListener('pointermove', track);
      host.removeEventListener('pointerdown', track);
      ends.forEach(type => host.removeEventListener(type, reset));
      reset();
    };
  }, [grid, visible, selector]);
}

export function expandToolCard(card: HTMLElement, open: () => void) {
  if (!document.startViewTransition || reducedMotion()) return open();
  const root = document.documentElement;
  if (root.hasAttribute('data-expanding-card')) return open();
  root.dataset.expandingCard = '';
  card.style.viewTransitionName = 'tool-detail';
  const transition = document.startViewTransition(() => {
    card.style.removeProperty('view-transition-name');
    flushSync(open);
  });
  void transition.finished.finally(() => {
    delete root.dataset.expandingCard;
    card.style.removeProperty('view-transition-name');
  });
}
