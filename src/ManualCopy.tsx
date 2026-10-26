import { useEffect, useId, useRef, useState } from "react";

export default function ManualCopy() {
  const [text, setText] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    heading = useId();
  useEffect(() => {
    const open = (event: Event) =>
      setText((event as CustomEvent<string>).detail);
    window.addEventListener("devkit:manual-copy", open);
    return () => window.removeEventListener("devkit:manual-copy", open);
  }, []);
  useEffect(() => {
    if (text === null) return;
    const previous = document.activeElement,
      current = dialog.current;
    current?.showModal();
    input.current?.focus();
    input.current?.select();
    return () => {
      current?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [text]);
  if (text === null) return null;
  return (
    <dialog
      ref={dialog}
      className="manual-copy-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        setText(null);
      }}
    >
      <header>
        <h2 id={heading}>手动复制</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭手动复制"
          onClick={() => setText(null)}
        >
          ×
        </button>
      </header>
      <p>
        浏览器未允许自动复制。下方文本已选中，请按 Ctrl+C（Mac 使用
        ⌘C），或使用右键菜单复制。
      </p>
      <textarea
        ref={input}
        readOnly
        aria-label="待手动复制的文本"
        value={text}
        spellCheck={false}
      />
      <footer>
        <button
          className="secondary-button"
          onClick={() => input.current?.select()}
        >
          全选文本
        </button>
        <button className="run-button" onClick={() => setText(null)}>
          关闭
        </button>
      </footer>
    </dialog>
  );
}
