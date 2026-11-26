import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export function OverflowName({ name }: { name: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = viewport.current!, text = track.current!;
    const measure = () => setOverflow(Math.max(0, text.offsetWidth - box.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(text);
    return () => observer.disconnect();
  }, [name]);

  return <span className="file-name" ref={viewport} tabIndex={overflow > 0 ? 0 : undefined}
      title={name} data-overflow={overflow > 0}
      style={{ '--file-shift': `-${overflow}px`, '--file-duration': `${overflow / 36}s` } as CSSProperties}>
      <span className="file-name-label">{name}</span>
      <span aria-hidden="true" ref={track} className="file-name-track">{name}</span>
    </span>;
}

export default function FileMeta({ name, encoding }: { name: string; encoding: string }) {
  return <div className="file-meta">
    <OverflowName name={name} />
    <span className="file-encoding">{encoding}</span>
  </div>;
}
