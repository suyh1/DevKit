import { lanRequest } from './lan-api';

export const clipboardLimit = 16 * 1024;
const textSize = (text: string) => new TextEncoder().encode(text).length;

export async function readSessionClipboard(): Promise<string> {
  return window.devkitDesktop?.lanHosts ? lanRequest<string>('clipboard-read') : navigator.clipboard.readText();
}

// LAN HTTP pages can write during a recent user gesture through the native copy event.
function copyWithEvent(text: string) {
  let written = false;
  function copy(event: ClipboardEvent) {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    written = true;
  }
  document.addEventListener('copy', copy, true);
  try { return document.execCommand('copy') && written; }
  finally { document.removeEventListener('copy', copy, true); }
}

type Options = {
  enabled: () => boolean;
  sendText: (text: string) => void | Promise<void>;
  key: (symbol: number, code: string, down: boolean) => void;
  notice: (message: string) => void;
};

export function bindRemoteClipboard(viewport: HTMLElement, { enabled, sendText, key, notice }: Options) {
  const listeners = new AbortController(), capture = { capture: true, signal: listeners.signal };
  let leftControl = false, interacted = false, generation = 0;
  const consumed = new Set<string>();
  let lastSent: string | undefined;
  let pasteQueue = Promise.resolve();
  let pending: { deliver?: (text: string) => void; cancel: () => void; written?: Promise<boolean> } | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const focused = () => viewport.contains(document.activeElement) && viewport.getClientRects().length > 0;
  const active = () => !listeners.signal.aborted && enabled() && focused();

  function chord(letter: 'c' | 'v') {
    // Use the physical Ctrl state at delivery time. The user may have released it during the transfer.
    key(0xffe3, 'ControlLeft', true);
    const code = letter === 'c' ? 'KeyC' : 'KeyV';
    key(letter.charCodeAt(0), code, true);
    key(letter.charCodeAt(0), code, false);
    if (!leftControl) key(0xffe3, 'ControlLeft', false);
  }
  function cancelCopy() {
    clearTimeout(timeout);
    pending?.cancel();
    pending = undefined;
  }
  function beginCopy() {
    cancelCopy();
    pending = { cancel() {} };
    // Start the secure-browser write while the key gesture is live. Resolve it with the new remote selection.
    if (!window.devkitDesktop?.lanHosts && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const item = pending;
      const data = new Promise<Blob>((resolve, reject) => {
        item.deliver = text => resolve(new Blob([text], { type: 'text/plain' }));
        item.cancel = () => reject(new Error('Copy cancelled'));
      });
      void data.catch(() => {});
      try { item.written = navigator.clipboard.write([new ClipboardItem({ 'text/plain': data })]).then(() => true, () => false); }
      catch { /* Use the native copy event when the remote text arrives. */ }
    }
    timeout = setTimeout(() => {
      cancelCopy();
      if (active()) notice('未收到远端复制的文本，请确认目标允许剪贴板共享。');
    }, 5000);
    chord('c');
  }
  function paste(read: Promise<string> | string) {
    cancelCopy();
    const current = generation;
    const usable = () => current === generation && active() && document.hasFocus();
    // Capture each native paste once, then send clipboard data and its matching keystroke in order.
    pasteQueue = pasteQueue.then(async () => {
      const text = await read;
      if (!usable() || !text) return;
      if (textSize(text) > clipboardLimit) { notice('每次最多粘贴 16 KiB 文本。'); return; }
      lastSent = text;
      await sendText(text);
      if (usable()) chord('v');
    }).catch(() => { if (usable()) notice('粘贴失败，请检查会话的剪贴板权限。'); });
  }
  viewport.addEventListener('pointerdown', () => { interacted = true; }, capture);
  viewport.addEventListener('keydown', event => {
    if (!event.isTrusted || !active()) return;
    interacted = true;
    if (event.code === 'ControlLeft') leftControl = true;
    const letter = event.key.toLowerCase();
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || !['c','v'].includes(letter)) return;
    event.stopImmediatePropagation();
    consumed.add(event.code);
    if (event.repeat) { event.preventDefault(); return; }
    notice('');
    if (letter === 'c') { event.preventDefault(); beginCopy(); }
    else if (window.devkitDesktop?.lanHosts) { event.preventDefault(); paste(readSessionClipboard()); }
    // In a browser let Ctrl+V dispatch its trusted paste event, including on ordinary LAN HTTP.
  }, capture);
  viewport.addEventListener('keyup', event => {
    if (event.code === 'ControlLeft') leftControl = false;
    if (consumed.delete(event.code)) { event.stopImmediatePropagation(); event.preventDefault(); }
  }, capture);
  viewport.addEventListener('paste', event => {
    if (!event.isTrusted || !active()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.clipboardData?.types.includes('text/plain')) paste(event.clipboardData.getData('text/plain'));
  }, capture);
  function reset() {
    if (leftControl && enabled()) key(0xffe3, 'ControlLeft', false);
    generation++; leftControl = false; interacted = false; lastSent = undefined; consumed.clear(); cancelCopy();
  }
  viewport.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !viewport.contains(event.relatedTarget)) reset();
    else if (!event.relatedTarget) {
      // Changing applications can blur the element before the remote copy reply.
      queueMicrotask(() => { if (document.hasFocus() && !focused()) reset(); });
    }
  }, capture);
  window.addEventListener('blur', () => { leftControl = false; consumed.clear(); interacted = false; generation++; }, { signal: listeners.signal });

  return {
    async receive(text: string) {
      if (listeners.signal.aborted || !enabled() || !viewport.getClientRects().length) return;
      if (!pending && !(interacted && focused() && document.hasFocus())) return;
      // Some servers echo ClientCutText. Preserve richer formats on the local clipboard in that case.
      const echoed = text === lastSent;
      lastSent = undefined;
      if (echoed && !pending) return;
      const item = pending;
      pending = undefined; clearTimeout(timeout);
      if (textSize(text) > clipboardLimit) { item?.cancel(); notice('远端剪贴板文本超过 16 KiB'); return; }
      try {
        if (window.devkitDesktop?.lanHosts) { await lanRequest('clipboard-write', text); return; }
        if (item?.deliver) {
          item.deliver(text);
          if (await item.written) return;
        }
        if (!active() || !document.hasFocus()) return;
        if (copyWithEvent(text)) return;
        await navigator.clipboard.writeText(text);
      } catch { if (active()) notice('浏览器未允许写入本机剪贴板，可从「文本剪贴板」复制。'); }
    },
    reset,
    dispose() { reset(); listeners.abort(); },
  };
}
