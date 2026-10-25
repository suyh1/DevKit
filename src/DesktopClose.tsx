import { useEffect, useId, useRef, useState } from 'react';
import { Monitor, X } from 'lucide-react';

export function CloseChoice({ onDone }: { onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  const [remember, setRemember] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const heading = useId(),
    description = useId();
  useEffect(() => {
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => dialog.current?.close();
  }, []);
  async function choose(action: 'cancel' | 'tray' | 'quit') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await window.devkitDesktop?.chooseClose(action, remember);
      window.dispatchEvent(new Event('devkit:close-setting-changed'));
      onDone();
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog close-choice"
      aria-labelledby={heading}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        void choose('cancel');
      }}
    >
      <button className="icon-button confirm-close" aria-label="取消关闭" disabled={busy} onClick={() => void choose('cancel')}>
        <X size={17} />
      </button>
      <div className="confirm-heading">
        <span className="confirm-icon">
          <Monitor size={21} />
        </span>
        <h2 id={heading}>关闭 DevKit</h2>
      </div>
      <p id={description}>可以退出软件，或最小化到系统托盘继续运行。托盘模式会保留当前草稿、请求和项目共享服务。</p>
      <label className="close-remember">
        <input type="checkbox" checked={remember} disabled={busy} onChange={(event) => setRemember(event.target.checked)} />
        记住我的选择，可在“偏好设置”中修改
      </label>
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button ref={cancel} className="confirm-cancel" disabled={busy} onClick={() => void choose('cancel')}>
          取消
        </button>
        <button className="confirm-cancel" disabled={busy} onClick={() => void choose('quit')}>
          退出软件
        </button>
        <button className="run-button" disabled={busy} onClick={() => void choose('tray')}>
          最小化到托盘
        </button>
      </footer>
    </dialog>
  );
}

export function WindowCloseSetting() {
  const [action, setAction] = useState<'ask' | 'tray' | 'quit'>('ask'),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => {
      if (window.devkitDesktop)
        void window.devkitDesktop
          .closeSettings('get')
          .then((value) => {
            if (active) {
              setAction(value.closeAction);
              setError('');
            }
          })
          .catch((error) => {
            if (active) setError(String(error));
          })
          .finally(() => {
            if (active) setBusy(false);
          });
    };
    load();
    window.addEventListener('devkit:close-setting-changed', load);
    return () => {
      active = false;
      window.removeEventListener('devkit:close-setting-changed', load);
    };
  }, []);
  async function change(value: typeof action) {
    setBusy(true);
    setError('');
    try {
      const saved = await window.devkitDesktop!.closeSettings('set', value);
      setAction(saved.closeAction);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <h2>
        <Monitor size={17} />
        窗口与托盘
      </h2>
      <label className="setting-row">
        <span>
          <strong>点击关闭按钮时</strong>
          <small>{window.devkitDesktop ? '托盘菜单可重新打开或退出；退出时仍保护未保存的草稿' : '此设置仅支持桌面端'}</small>
        </span>
        <select
          aria-label="窗口关闭行为"
          value={action}
          disabled={busy || !window.devkitDesktop}
          onChange={(event) => void change(event.target.value as typeof action)}
        >
          <option value="ask">每次询问</option>
          <option value="tray">最小化到托盘</option>
          <option value="quit">退出软件</option>
        </select>
      </label>
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
