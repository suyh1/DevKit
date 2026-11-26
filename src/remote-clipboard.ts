import { lanRequest } from './lan-api';

import { checkText, type ClipboardProtocol } from './clipboard-formats';

type PasteContent = { kind: 'text'; text: string } | { kind: 'files'; files?: File[] } | { kind: 'png'; bytes: ArrayBuffer };

export async function writeSessionImage(blob: Blob) {
  if (window.devkitDesktop?.lanHosts) return lanRequest('clipboard-write-image', await blob.arrayBuffer());
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function copyScreen(png: Promise<Blob>, notice: (message: string) => void) {
  try {
    if (!window.devkitDesktop?.lanHosts && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    else await writeSessionImage(await png);
    notice('远端画面已复制到本机。');
  } catch {
    try { downloadBlob(await png, '远端画面.png'); notice('已下载远端画面的 PNG。'); }
    catch { notice('无法读取当前画面。'); }
  }
}


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
  protocol: ClipboardProtocol;
  sendLongText?: (text: string, usable: () => boolean) => Promise<void>;
  sendFiles: (files: File[], usable: () => boolean) => Promise<boolean>;
  enabled: () => boolean;
  sendText: (text: string, usable: () => boolean) => void | Promise<void>;
  key: (symbol: number, code: string, down: boolean) => void;
  notice: (message: string) => void;
};

export function bindRemoteClipboard(viewport: HTMLElement, { protocol, enabled, sendText, sendFiles, sendLongText, key, notice }: Options) {
  const listeners = new AbortController(), capture = { capture: true, signal: listeners.signal };
  let leftControl = false, interacted = false, generation = 0;
  const consumed = new Set<string>();
  let lastSent: string | undefined;
  let pasteQueue = Promise.resolve(), copyRevision = 0;
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
    copyRevision++;
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
      if (active()) notice('未收到支持的剪贴板格式，请确认远端允许复制。');
    }, 5000);
    chord('c');
  }
  function paste(read: Promise<PasteContent> | PasteContent) {
    cancelCopy();
    const current = generation;
    const usable = () => current === generation && active() && document.hasFocus();
    // Capture each native paste once, then send clipboard data and its matching keystroke in order.
    pasteQueue = pasteQueue.then(async () => {
      const content = await read;
      if (!usable()) return;
      if (content.kind !== 'text') {
        const files = content.kind === 'png' ? [new File([content.bytes], '截图.png', { type: 'image/png' })] : content.files || [];
        if (await sendFiles(files, usable) && usable()) chord('v');
        return;
      }
      const text = content.text;
      if (!text) return;
      const problem = checkText(text, protocol);
      if (problem) {
        if (sendLongText) await sendLongText(text, usable);
        else notice(problem);
        return;
      }
      lastSent = text;
      await sendText(text, usable);
      if (usable()) chord('v');
    }).catch(error => { if (usable()) notice(error.message || '粘贴失败，请检查会话的剪贴板权限。'); });
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
    else if (window.devkitDesktop?.lanHosts) { event.preventDefault(); paste(lanRequest<PasteContent>('clipboard-content')); }
    // In a browser let Ctrl+V dispatch its trusted paste event, including on ordinary LAN HTTP.
  }, capture);
  viewport.addEventListener('keyup', event => {
    if (event.code === 'ControlLeft') leftControl = false;
    if (consumed.delete(event.code)) { event.stopImmediatePropagation(); event.preventDefault(); }
  }, capture);
  viewport.addEventListener('paste', event => {
    if (!event.isTrusted || !active()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const data = event.clipboardData;
    if (data?.files.length) paste({ kind: 'files', files: Array.from(data.files) });
    else if (data?.types.includes('text/plain')) paste({ kind: 'text', text: data.getData('text/plain') });
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
      copyRevision++;
      const item = pending;
      pending = undefined; clearTimeout(timeout);
      const problem = checkText(text, protocol === 'web-rdp' ? 'web-vnc' : protocol);
      if (problem) { item?.cancel(); notice(problem); return; }
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
    async receiveImage(convert: () => Promise<Blob>) {
      if (!enabled() || listeners.signal.aborted || !viewport.getClientRects().length || (!pending && !(interacted && focused() && document.hasFocus()))) return;
      cancelCopy();
      const revision = copyRevision;
      try {
        const png = await convert();
        if (revision === copyRevision && enabled() && !listeners.signal.aborted) await writeSessionImage(png);
      } catch (error) { if (enabled()) notice((error as Error).message || '无法复制远端位图。'); }
    },
    reset,
    dispose() { reset(); listeners.abort(); },
  };
}
