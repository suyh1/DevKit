import type { CSSProperties, ReactNode } from 'react';

type Choice<T extends string> = { value: T; label: string; content?: ReactNode };

export default function SegmentedControl<T extends string>({ label, value, options, onChange, className = '' }: {
  label: string; value: T; options: Choice<T>[]; onChange: (value: T) => void; className?: string;
}) {
  return <div className={`segmented-control ${className}`} role="group" aria-label={label}
    style={{ '--segment-count': options.length, '--segment-index': Math.max(0, options.findIndex(option => option.value === value)) } as CSSProperties}>
    <span className="segment-indicator" aria-hidden="true" />
    {options.map((option, index) => <button key={option.value} type="button" aria-label={option.label} aria-pressed={value === option.value}
      onClick={() => onChange(option.value)} onKeyDown={event => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % options.length;
        else if (event.key === 'ArrowLeft') next = (index + options.length - 1) % options.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = options.length - 1;
        else return;
        event.preventDefault(); onChange(options[next].value);
        event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
      }}>{option.content ?? option.label}</button>)}
  </div>;
}
