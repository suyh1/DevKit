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
      const range = selected.getRangeAt(0);
      const common = range.commonAncestorContainer;
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
      // A multiline selection may straddle the edge of an inner scrolling panel.
      for (let el = common instanceof Element ? common : common.parentElement; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const box = el.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          left = Math.max(left, box.left + el.clientLeft);
          right = Math.min(right, box.left + el.clientLeft + el.clientWidth);
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, box.top + el.clientTop);
          bottom = Math.min(bottom, box.top + el.clientTop + el.clientHeight);
        }
      }
      const rect = Array.from(range.getClientRects()).find(box =>
        Math.min(box.right, right) > Math.max(box.left, left) &&
        Math.min(box.bottom, bottom) > Math.max(box.top, top));
      if (!rect || container.closest('[inert], [hidden]')) {
        setSelection(undefined);
        return;
      }
      setSelection({
        text: selected.toString(),
        x: Math.max(6, Math.min(innerWidth - 100, Math.max(left, rect.left))),
        y: Math.max(4, Math.max(top, rect.top) - 36),
      });
    }
    const observer = new ResizeObserver(update);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', update);
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
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
