import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TextArea, TextInput } from './TextControl';

it('preserves external labels and validation hints on the editable element', () => {
  for (const Field of [TextInput, TextArea] as const) {
    const html = renderToStaticMarkup(<Field id="address" aria-labelledby="address-label"
      aria-describedby="address-hint address-error" aria-invalid readOnly value="localhost" />);
    expect(html).toContain('id="address"');
    expect(html).toContain('aria-labelledby="address-label"');
    expect(html).toContain('aria-describedby="address-hint address-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('readOnly=""');
  }
});
