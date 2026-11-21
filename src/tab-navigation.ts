import type { KeyboardEvent } from 'react';

export function navigateTabList(event: KeyboardEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || target.getAttribute('role') !== 'tab') return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]:enabled'));
  const index = tabs.indexOf(target);
  if (index < 0) return;
  let next: number;
  switch (event.key) {
    case 'Home': next = 0; break;
    case 'End': next = tabs.length - 1; break;
    case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
    case 'ArrowRight': next = (index + 1) % tabs.length; break;
    default: return;
  }
  event.preventDefault();
  tabs[next].focus();
  if (next !== index) tabs[next].click();
}
