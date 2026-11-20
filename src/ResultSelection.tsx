import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function ResultSelection({
  children,
  onCopy,
}: {
  children: ReactNode;
  onCopy: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number }>();
  useEffect(() => {
    function update() {
      const selected = window.getSelection();
      const container = ref.current;
      if (
        !selected?.rangeCount ||
        selected.isCollapsed ||
        !container?.contains(selected.anchorNode) ||
        !container.contains(selected.focusNode) ||
        selected.anchorNode?.parentElement?.closest('input,textarea,[contenteditable=true]')
      ) {
        setSelection(undefined);
        return;
      }
      const rect = selected.getRangeAt(0).getBoundingClientRect();
      setSelection({
        text: selected.toString(),
        x: Math.max(6, Math.min(innerWidth - 100, rect.left)),
        y: Math.max(4, rect.top - 36),
      });
    }
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);
  return (
    <div className="editor-body output-body" ref={ref}>
      {children}
      {selection?.text &&
        createPortal(
          <button
            className="selection-copy"
            style={{ left: selection.x, top: selection.y }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCopy(selection.text)}
          >
            复制选区
          </button>,
          document.body,
        )}
    </div>
  );
}
