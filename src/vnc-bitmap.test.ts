import { describe, expect, it } from 'vitest';
import { decodeDib, encodeDib } from './vnc-bitmap';
import { checkText } from './clipboard-formats';

describe('VNC clipboard bitmap', () => {
  it('preserves BGRA channel order, orientation and alpha', () => {
    const rgba = new Uint8ClampedArray([20, 40, 60, 128, 10, 30, 50, 255]);
    const bytes = encodeDib(1, 2, rgba);
    expect([...bytes.slice(124)]).toEqual([60, 40, 20, 128, 50, 30, 10, 255]);
    expect(decodeDib(bytes)).toEqual({ width: 1, height: 2, rgba });
  });
  it('reads bottom-up padded 24-bit rows and rejects truncated data', () => {
    const bytes = encodeDib(1, 2, new Uint8ClampedArray(8));
    const view = new DataView(bytes.buffer);
    view.setInt32(8, 2, true); view.setUint16(14, 24, true); view.setUint32(16, 0, true);
    bytes.set([6, 5, 4, 0, 3, 2, 1, 0], 124);
    expect([...decodeDib(bytes).rgba]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(() => decodeDib(bytes.subarray(0, 128))).toThrow();
    view.setInt32(4, 0x7fffffff, true);
    expect(() => decodeDib(bytes)).toThrow();
  });
});

it('checks both gateway encodings, including their terminators', () => {
  expect(checkText('a'.repeat(131071), 'web-rdp')).toBe('');
  expect(checkText('a'.repeat(131072), 'web-rdp')).toContain('UTF-16');
  expect(checkText('界'.repeat(87382), 'web-rdp')).toContain('UTF-8');
  expect(checkText('a'.repeat(262143), 'web-vnc')).toBe('');
  expect(checkText('a'.repeat(4194304), 'desktop-vnc')).toBe('');
  expect(checkText('a'.repeat(4194305), 'desktop-vnc')).toContain('4 MiB');
});
