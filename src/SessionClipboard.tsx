import { useState } from 'react';
import { copyText } from './motion-primitives';
import { lanRequest } from './lan-api';

export const clipboardLimit = 16 * 1024;
export async function readSessionClipboard(): Promise<string> {
  return window.devkitDesktop?.lanHosts ? lanRequest<string>('clipboard-read') : navigator.clipboard.readText();
}

export default function SessionClipboard({ remote, send, readOnly = false }: {
  remote: string; send: (text: string) => Promise<void> | void; readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(''), [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function paste() {
    if (new TextEncoder().encode(draft).length > clipboardLimit) { setStatus('每次最多发送 16 KiB 文本。'); return; }
    setBusy(true);
    try { await send(draft); setStatus('文本已发送到远端剪贴板'); }
    catch (error) { setStatus((error as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="lan-session-clipboard"><summary>文本剪贴板</summary>
    <div><label>发往远端<textarea value={draft} maxLength={clipboardLimit} disabled={readOnly} onChange={e => setDraft(e.target.value)} /></label>
    <div><button className="text-button" disabled={readOnly} onClick={async () => {
      try { const value = await readSessionClipboard();
        if (new TextEncoder().encode(value).length > clipboardLimit) { setStatus('每次最多发送 16 KiB 文本。'); return; }
        setDraft(value); setStatus('');
      } catch { setStatus('请直接在输入框中粘贴本机文本。'); }
    }}>读取本机文本</button><button className="secondary-button" disabled={busy || readOnly || !draft} onClick={() => void paste()}>发送到远端</button></div>
    <label>来自远端<textarea readOnly value={remote} /></label>
    <button className="text-button" disabled={!remote} onClick={() => void copyText(remote).then(() => setStatus('已复制到本机'), () => setStatus('请选中远端文本并复制。'))}>复制到本机</button>
    <span role="status">{status}</span></div>
  </details>;
}
