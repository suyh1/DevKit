export function surfaceHostVisible(node: HTMLElement) {
  return !!node.parentElement && !node.parentElement.closest('[hidden], [inert], dialog:not([open]), details:not([open])');
}

/** Native top-layer surfaces must follow their workspace when a kept-alive page is hidden. */
export function followSurfaceHost(node: HTMLElement, update: (visible: boolean) => void) {
  const parent = node.parentElement;
  const sync = () => update(surfaceHostVisible(node));
  const observer = new MutationObserver(sync);
  for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
    observer.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert', 'open'] });
  }
  sync();
  return () => observer.disconnect();
}
