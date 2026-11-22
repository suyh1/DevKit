import { Input, Textarea } from '@headlessui/react';
import { Fragment, type ComponentPropsWithRef } from 'react';

type Appearance = { embedded?: boolean };

// Keep validation hints, refs and form attributes on the actual editable element.
function controlClass(embedded: boolean, className?: string) {
  return [embedded ? 'text-control-embedded' : 'text-control', className].filter(Boolean).join(' ');
}

function fieldState({ id, disabled, autoFocus, 'aria-invalid': invalid }: Pick<ComponentPropsWithRef<'input'>, 'id' | 'disabled' | 'autoFocus' | 'aria-invalid'>) {
  return { id, disabled, autoFocus, invalid: !!invalid && invalid !== 'false' };
}

export function TextInput({ embedded = false, className, ...props }: ComponentPropsWithRef<'input'> & Appearance) {
  return <Input as={Fragment} {...fieldState(props)}>
    <input {...props} className={controlClass(embedded, className)} />
  </Input>;
}

export function TextArea({ embedded = false, className, ...props }: ComponentPropsWithRef<'textarea'> & Appearance) {
  return <Textarea as={Fragment} {...fieldState(props)}>
    <textarea {...props} className={controlClass(embedded, className)} />
  </Textarea>;
}
