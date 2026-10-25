import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileWarning, X } from 'lucide-react';
import './confirmation.css';

type Options = { title: string; detail: string; confirm: string; cancel?: string; context?: string };
type Request = (options: Options) => Promise<boolean>;
const ConfirmationContext = createContext<Request | null>(null);

export function useConfirmation() {
  const request = useContext(ConfirmationContext);
  if (!request) throw new Error('确认弹窗需要位于工作台中。');
  return request;
}
export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
}
function ConfirmationDialog({ options, settle }: { options: Options & { sequence: number }; settle: (allow: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const heading = useId(), description = useId();
  useEffect(() => {
    dialog.current?.showModal(); cancel.current?.focus();
    return () => dialog.current?.close();
  }, [options.sequence]);
  return <dialog ref={dialog} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={heading} aria-describedby={description} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); settle(false); } }} onCancel={event => { event.preventDefault(); settle(false); }}>
    <button className="icon-button confirm-close" aria-label={options.cancel || '继续编辑'} onClick={() => settle(false)}><X size={17} /></button>
    <div className="confirm-heading"><span className="confirm-icon"><FileWarning size={21} /></span><div>{options.context && <small>{options.context}</small>}<h2 id={heading}>{options.title}</h2></div></div>
    <p id={description}>{options.detail}</p>
    <footer><button ref={cancel} className="confirm-cancel" onClick={() => settle(false)}>{options.cancel || '继续编辑'}</button><button className="confirm-discard" onClick={() => settle(true)}>{options.confirm}</button></footer>
  </dialog>;
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<(Options & { sequence: number }) | null>(null);
  const pending = useRef<((allow: boolean) => void) | null>(null), sequence = useRef(0);
  const request = useCallback<Request>(next => new Promise(resolve => {
    // A close-app request replaces a local discard request in the same layer.
    pending.current?.(false); pending.current = resolve;
    setOptions({ ...next, sequence: ++sequence.current });
  }), []);
  const settle = useCallback((allow: boolean) => {
    const resolve = pending.current; pending.current = null;
    setOptions(null); resolve?.(allow);
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  useEffect(() => window.devkitDesktop?.onCloseRequest(intent => {
    const reload = intent === 'reload';
    void request({ context: '未保存的更改', title: reload ? '重新加载工作台？' : '关闭 DevKit？', detail: reload ? '当前还有未保存的更改。重新加载会放弃这些更改，已保存的文件不会受到影响。' : '当前还有未保存的更改。关闭后这些更改将被放弃，已保存的文件不会受到影响。', confirm: reload ? '放弃并重新加载' : '放弃并关闭' }).then(allow => window.devkitDesktop?.answerClose(allow));
  }), [request]);
  return <ConfirmationContext.Provider value={request}>{children}{options && <ConfirmationDialog options={options} settle={settle} />}</ConfirmationContext.Provider>;
}
