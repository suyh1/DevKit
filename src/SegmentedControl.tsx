import type { ReactNode } from 'react';
import { MotionGroup } from './Motion';

type Choice<T extends string> = { value: T; label: string; content?: ReactNode; disabled?: boolean };

export default function SegmentedControl<T extends string>({ label, value, options, onChange, disabled = false, className = '' }: {
  label: string; value: T; options: Choice<T>[]; onChange: (value: T) => void; className?: string; disabled?: boolean;
}) {
  const selected = options.find(option => option.value === value) ?? options[0];
  const available = options.filter(option => !option.disabled);
  const focusable = selected?.disabled ? available[0] : selected;
  return <MotionGroup className={`segmented-control ${className}`} role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" value={option.value} disabled={disabled || option.disabled} tabIndex={option === focusable ? 0 : -1} aria-label={option.label} aria-pressed={option === selected}
      onClick={() => onChange(option.value)} onKeyDown={event => {
        const index = available.indexOf(option);
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % available.length;
        else if (event.key === 'ArrowLeft') next = (index + available.length - 1) % available.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = available.length - 1;
        else return;
        event.preventDefault(); onChange(available[next].value);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')[next]?.focus();
      }}>{option.content ?? option.label}</button>)}
  </MotionGroup>;
}
