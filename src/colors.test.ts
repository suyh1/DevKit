import { describe, expect, it } from 'vitest';
import { parseColor, colorFormats, toHsl, fromHsl, hexColor, composite, luminance, contrastReport, mixColors, harmonyColors, shadeColors, shadeLabels, paletteExport, gradientCss } from './colors';
import { transform } from './tools';

describe('color formats and math', () => {
  it('parses short/long HEX with alpha and common named colors', () => {
    expect(hexColor(parseColor('#abc'))).toBe('#AABBCC');
    expect(hexColor(parseColor('#abcd'))).toBe('#AABBCCDD');
    expect(hexColor(parseColor('147d64'))).toBe('#147D64');
    expect(parseColor('#ff000080').a).toBeCloseTo(128 / 255);
    expect(hexColor(parseColor('transparent'))).toBe('#00000000');
    expect(hexColor(parseColor('rebeccapurple'))).toBe('#663399');
  });
  it('parses comma and modern RGB/HSL syntax, percentages and hue units', () => {
    expect(parseColor('rgba(255, 0, 127, 0.5)')).toEqual({ r: 255, g: 0, b: 127, a: 0.5 });
    expect(hexColor(parseColor('rgb(100% 0% 0% / 50%)'))).toBe('#FF000080');
    expect(hexColor(parseColor('hsl(-120deg 100% 50%)'))).toBe('#0000FF');
    expect(hexColor(parseColor('hsla(0.5turn, 100%, 50%, 25%)'))).toBe('#00FFFF40');
    expect(hexColor(parseColor(`hsl(${Math.PI}rad 100% 50%)`))).toBe('#00FFFF');
    expect(hexColor(parseColor('hsl(200grad 100% 50%)'))).toBe('#00FFFF');
  });
  it('rejects invalid/out-of-range values and executable CSS', () => {
    for (const input of ['', '#12345', '#zzzzzz', 'rgb(256 0 0)', 'rgb(-1 0 0)', 'rgb(1 2 3 / 101%)', 'rgb(1,,2)', 'rgb(1,2,3 / .5)', 'hsl(1 50 50)', 'url(https://example.com)', 'red; color:black']) expect(() => parseColor(input), input).toThrow();
  });
  it('round-trips HSL across achromatic and chromatic sample colors', () => {
    for (const input of ['#000', '#fff', '#808080', '#147d64', '#ef4444', '#22c55e', '#3b82f6', '#12345678']) {
      const color = parseColor(input), hsl = toHsl(color), back = fromHsl(hsl.h, hsl.s, hsl.l, color.a);
      expect(back.r).toBeCloseTo(color.r, 8); expect(back.g).toBeCloseTo(color.g, 8); expect(back.b).toBeCloseTo(color.b, 8);
      expect(hexColor(back)).toBe(hexColor(color));
    }
  });
  it('formats HSV, CMYK, HEXA and alpha without a black divide-by-zero', () => {
    expect(colorFormats(parseColor('red')).HSV).toBe('0°, 100%, 100%');
    expect(colorFormats(parseColor('red')).CMYK).toBe('0%, 100%, 100%, 0%');
    expect(colorFormats(parseColor('black')).CMYK).toBe('0%, 0%, 0%, 100%');
    expect(colorFormats(parseColor('#123456')).HEXA).toBe('#123456FF');
    expect(colorFormats(parseColor('rgb(1 2 3 / 0)')).RGB).toContain('/ 0%');
  });
  it('composites transparent foregrounds and backgrounds using source-over', () => {
    const result = composite(parseColor('rgb(255 0 0 / .5)'), parseColor('blue'));
    expect(result).toEqual({ r: 127.5, g: 0, b: 127.5, a: 1 });
    expect(composite(parseColor('transparent'), parseColor('transparent'))).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(luminance(parseColor('black'))).toBe(0);
    expect(luminance(parseColor('white'))).toBe(1);
  });
  it('checks WCAG thresholds against unrounded contrast and accounts for alpha', () => {
    expect(contrastReport(parseColor('black'), parseColor('white')).ratio).toBe(21);
    expect(contrastReport(parseColor('white'), parseColor('white')).ratio).toBe(1);
    expect(contrastReport(parseColor('#777'), parseColor('white')).aa).toBe(false);
    expect(contrastReport(parseColor('#767676'), parseColor('white')).aa).toBe(true);
    const borderline = contrastReport(parseColor('rgb(118.66 118.66 118.66)'), parseColor('white'));
    expect(borderline.ratio.toFixed(2)).toBe('4.50'); expect(borderline.aa).toBe(false);
    expect(contrastReport(parseColor('rgb(0 0 0 / .5)'), parseColor('white')).ratio).toBeCloseTo(3.976653, 5);
    expect(contrastReport(parseColor('black'), parseColor('transparent')).ratio).toBe(21);
  });
  it('mixes using sRGB or linear-light and preserves premultiplied alpha', () => {
    const black = parseColor('black'), white = parseColor('white');
    expect(hexColor(mixColors(black, white, .5))).toBe('#808080');
    expect(hexColor(mixColors(black, white, .5, 'linear'))).toBe('#BCBCBC');
    expect(hexColor(mixColors(black, white, 0))).toBe('#000000');
    expect(hexColor(mixColors(black, white, 1))).toBe('#FFFFFF');
    expect(hexColor(mixColors(parseColor('red'), parseColor('rgb(0 0 255 / 0)'), .5))).toBe('#FF000080');
  });
  it('generates hue harmonies, monotonic shades and usable exports', () => {
    const red = parseColor('red');
    expect(harmonyColors(red, 'complementary').map(color => hexColor(color))).toEqual(['#FF0000', '#00FFFF']);
    expect(harmonyColors(red, 'triadic').map(color => hexColor(color))).toEqual(['#FF0000', '#00FF00', '#0000FF']);
    expect(harmonyColors(red, 'tetradic')).toHaveLength(4);
    const shades = shadeColors(red).map(toHsl);
    expect(shades).toHaveLength(11);
    expect(shades.every((shade, index) => !index || shade.l < shades[index - 1].l)).toBe(true);
    expect(paletteExport([red])).toBe(':root {\n  --color-1: #FF0000;\n}');
    expect(JSON.parse(paletteExport(shadeColors(red), shadeLabels, 'json'))['color-50']).toBeTruthy();
  });
  it('generates gradients with consistent stops and validates stop counts', () => {
    const colors = ['red', 'green', 'blue'].map(parseColor);
    expect(gradientCss(colors, 90)).toBe('linear-gradient(90deg, #FF0000 0%, #008000 50%, #0000FF 100%)');
    expect(gradientCss(colors, 90, 'radial')).toContain('radial-gradient(circle,');
    expect(() => gradientCss([colors[0]])).toThrow();
    expect(() => gradientCss(colors, NaN)).toThrow();
  });
  it('exposes all six color utilities through the shared tool engine', async () => {
    expect(JSON.parse(await transform('color-convert', 'red')).HEX).toBe('#FF0000');
    expect(await transform('color-palette', 'red')).toContain('--color-1:');
    expect(await transform('color-gradient', 'red', { second: 'blue' })).toContain('linear-gradient(');
    expect(JSON.parse(await transform('color-contrast', 'black', { second: 'white' })).AAA).toBe(true);
    expect(JSON.parse(await transform('color-mix', 'black', { second: 'white', amount: '50' })).HEX).toBe('#808080');
    await expect(transform('color-mix', 'red', { amount: 'NaN' })).rejects.toThrow();
  });
});
