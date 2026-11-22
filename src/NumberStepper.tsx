import { useId, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';

type Props = {
  label: string;
  className: string;
  value: string;
  min: number;
  max?: number;
  disabled: boolean;
  onChange: (value: string) => void;
};

export default function NumberStepper({ label, className, value, min, max, disabled, onChange }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  function step(direction: 1 | -1) {
    const field = input.current;
    if (!field || field.matches(':disabled')) return;
    if (direction === 1) field.stepUp();
    else field.stepDown();
    onChange(field.value);
  }
  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      <div className="number-stepper">
        <button
          type="button"
          aria-label={'减少' + label}
          disabled={disabled || (value !== '' && Number(value) <= min)}
          onClick={() => step(-1)}
        >
          <Minus size={14} />
        </button>
        <input
          id={id}
          ref={input}
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={'增加' + label}
          disabled={disabled || (max !== undefined && value !== '' && Number(value) >= max)}
          onClick={() => step(1)}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
