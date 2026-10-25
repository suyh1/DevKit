import type { ReactNode } from 'react';
import { MotionGroup } from './Motion';

type Choice<T extends string> = { value: T; label: string; content?: ReactNode };

export default function SegmentedControl<T extends string>({ label, value, options, onChange, className = '' }: {
  label: string; value: T; options: Choice<T>[]; onChange: (value: T) => void; className?: string;
}) {
  return <MotionGroup className={`segmented-control ${className}`} role="group" aria-label={label}>
    {options.map((option, index) => <button key={option.value} type="button" tabIndex={value === option.value ? 0 : -1} aria-label={option.label} aria-pressed={value === option.value}
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
  </MotionGroup>;
}
