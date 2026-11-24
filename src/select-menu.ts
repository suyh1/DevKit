// Older engines can style the closed select, but draw its options in a system
// window. Keep the select as the form control and present its options in-page.
function installSelectMenu() {
  if (CSS.supports('appearance: base-select') && CSS.supports('selector(::picker(select))')) return;
  let dismiss: (() => void) | undefined;
  function single(target: EventTarget | null): target is HTMLSelectElement {
    return target instanceof HTMLSelectElement && !target.matches(':disabled,[multiple],[size]') &&
      !matchMedia('(forced-colors: active)').matches && 'showPopover' in HTMLElement.prototype;
  }
  function show(select: HTMLSelectElement) {
    dismiss?.();
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.popover = 'auto';
    menu.setAttribute('role', 'listbox');
    menu.tabIndex = -1;
    menu.setAttribute('aria-label', select.getAttribute('aria-label') || select.labels?.[0]?.firstChild?.textContent?.trim() || '选择选项');
    const choices = [...select.options].filter(option => !option.hidden && !option.closest('optgroup[hidden]'));
    let active = -1;
    const rows = choices.map((option, index) => {
      const row = document.createElement('div');
      row.id = 'devkit-select-choice-' + index;
      row.setAttribute('role', 'option');
      row.textContent = option.label;
      row.setAttribute('aria-selected', String(option.selected));
      row.setAttribute('aria-disabled', String(option.matches(':disabled')));
      const group = option.parentElement;
      if (group instanceof HTMLOptGroupElement && group.firstElementChild === option) {
        const heading = document.createElement('div');
        heading.className = 'select-group-label'; heading.textContent = group.label; menu.append(heading);
      }
      row.onpointermove = () => { if (!option.matches(':disabled')) highlight(index, false); };
      row.onclick = event => { event.preventDefault(); choose(index); };
      menu.append(row);
      return row;
    });
    const enabled = choices.map((option, i) => option.matches(':disabled') ? -1 : i).filter(i => i >= 0);
    function highlight(index: number, scroll = true) {
      if (!rows[index]) return;
      rows[active]?.removeAttribute('data-active');
      active = index;
      rows[index].dataset.active = '';
      menu.setAttribute('aria-activedescendant', rows[index].id);
      if (scroll) rows[index].scrollIntoView({ block: 'nearest' });
    }
    function choose(index: number) {
      const choice = choices[index];
      if (!choice || !select.contains(choice) || choice.matches(':disabled')) return;
      const changed = !choice.selected;
      select.selectedIndex = choice.index;
      close(true);
      if (changed) for (const name of ['input', 'change']) select.dispatchEvent(new Event(name, { bubbles: true }));
    }
    const listeners = new AbortController();
    function close(focus = false) {
      listeners.abort(); menu.remove(); dismiss = undefined;
      select.removeAttribute('aria-expanded');
      if (focus && select.isConnected) select.focus({ preventScroll: true });
    }
    let prefix = '', lastTyped = 0;
    menu.onkeydown = event => {
      const pos = enabled.indexOf(active);
      switch (event.key) {
        case 'ArrowDown': highlight(enabled[Math.min(pos + 1, enabled.length - 1)]); break;
        case 'ArrowUp': highlight(enabled[Math.max(0, pos - 1)]); break;
        case 'Home': highlight(enabled[0]); break;
        case 'End': highlight(enabled[enabled.length - 1]); break;
        case 'Enter': case ' ': choose(active); break;
        case 'Escape': close(true); break;
        case 'Tab': close(true); return;
        default: {
          if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
          const now = performance.now();
          prefix = (now - lastTyped < 600 ? prefix : '') + event.key.toLocaleLowerCase();
          lastTyped = now;
          const found = enabled.find(i => choices[i].label.toLocaleLowerCase().startsWith(prefix));
          if (found !== undefined) highlight(found);
        }
      }
      event.preventDefault(); event.stopPropagation();
    };
    select.after(menu);
    const rect = select.getBoundingClientRect();
    const below = innerHeight - rect.bottom - 8, above = rect.top - 8;
    const upward = below < 180 && above > below;
    menu.style.width = Math.min(rect.width, innerWidth - 16) + 'px';
    menu.style.maxHeight = Math.min(352, Math.max(40, upward ? above : below)) + 'px';
    menu.style.left = Math.max(8, Math.min(innerWidth - rect.width - 8, rect.left)) + 'px';
    if (upward) menu.style.bottom = (innerHeight - rect.top + 3) + 'px';
    else menu.style.top = (rect.bottom + 3) + 'px';
    menu.showPopover(); select.setAttribute('aria-expanded', 'true');
    menu.focus({ preventScroll: true });
    const current = choices.findIndex(option => option.selected && !option.matches(':disabled'));
    highlight(current < 0 ? enabled[0] : current);
    dismiss = close;
    menu.addEventListener('toggle', event => { if ((event as ToggleEvent).newState === 'closed') close(); }, { signal: listeners.signal });
    window.addEventListener('resize', () => close(), { once: true, signal: listeners.signal });
    window.addEventListener('scroll', event => { if (event.target !== menu && !menu.contains(event.target as Node)) close(); }, { capture: true, signal: listeners.signal });
  }
  document.addEventListener('pointerdown', event => {
    // Suppress the system picker. Opening an auto popover here lets the
    // matching pointerup light-dismiss it before the user can choose.
    if (event.button === 0 && single(event.target)) event.preventDefault();
  });
  document.addEventListener('click', event => {
    if (event.button === 0 && single(event.target)) {
      event.preventDefault();
      show(event.target);
    }
  });
  document.addEventListener('keydown', event => {
    if (single(event.target) && [' ', 'Enter', 'F4', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); show(event.target);
    }
  });
}
installSelectMenu();
