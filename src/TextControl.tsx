import { Input, Textarea } from '@headlessui/react';
import { Fragment, useImperativeHandle, useLayoutEffect, useRef, type ComponentPropsWithRef } from 'react';

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

// Older browsers without intrinsic field sizing need the rendered width to measure wrapped lines.
function fitTextArea(field: HTMLTextAreaElement) {
  if (!field.clientWidth) return;
  const top = field.scrollTop;
  field.style.height = 'auto';
  const border = field.offsetHeight - field.clientHeight;
  field.style.height = (field.scrollHeight + border) + 'px';
  field.scrollTop = top;
}

export function TextArea({ embedded = false, className, ref, ...props }: ComponentPropsWithRef<'textarea'> & Appearance) {
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => field.current!, []);
  useLayoutEffect(() => {
    const node = field.current;
    if (!node || CSS.supports('field-sizing', 'content')) return;
    let lastWidth = -1;
    const observer = new ResizeObserver(() => {
      if (lastWidth === node.clientWidth) return;
      lastWidth = node.clientWidth;
      fitTextArea(node);
    });
    const update = () => fitTextArea(node);
    observer.observe(node);
    node.addEventListener('input', update);
    return () => { observer.disconnect(); node.removeEventListener('input', update); };
  }, []);
  useLayoutEffect(() => {
    if (field.current && !CSS.supports('field-sizing', 'content')) fitTextArea(field.current);
  }, [props.value, props.defaultValue, props.placeholder]);
  return <Textarea as={Fragment} {...fieldState(props)}>
    <textarea {...props} ref={field} className={controlClass(embedded, className)} />
  </Textarea>;
}
