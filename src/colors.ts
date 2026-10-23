export type Color = { r: number; g: number; b: number; a: number };
export type ColorToolId = 'color-picker' | 'color-convert' | 'color-palette' | 'color-gradient' | 'color-contrast' | 'color-mix';
export const isColorTool = (id: string): id is ColorToolId => id.startsWith('color-');
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const rounded = (value: number, digits = 2) => Number(value.toFixed(digits));
const hue = (value: number) => ((value % 360) + 360) % 360;
const names: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', orange: '#ffa500', purple: '#800080', rebeccapurple: '#663399', teal: '#008080', navy: '#000080', lime: '#00ff00', maroon: '#800000', olive: '#808000', transparent: '#00000000' };
function numeric(text: string, max: number, percentage = false): number {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(text)) throw new Error('颜色分量格式无效。');
  const percent = text.endsWith('%');
  if (percentage && !percent) throw new Error('HSL 饱和度和明度需使用百分比。');
  const value = Number(percent ? text.slice(0, -1) : text) * (percent ? max / 100 : 1);
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`颜色分量超出 0–${max} 范围。`);
  return value;
}
export function fromHsl(h: number, s: number, l: number, a = 1): Color {
  const chroma = (1 - Math.abs(2 * l - 1)) * s, sector = hue(h) / 60;
  const x = chroma * (1 - Math.abs(sector % 2 - 1));
  const sectors = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  const [r, g, b] = sectors[Math.floor(sector)], offset = l - chroma / 2;
  return { r: (r + offset) * 255, g: (g + offset) * 255, b: (b + offset) * 255, a };
}
export function toHsl(color: Color) {
  const [r, g, b] = [color.r / 255, color.g / 255, color.b / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, l = (max + min) / 2;
  const h = delta === 0 ? 0 : max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return { h: hue(h), s: delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)), l };
}
export function parseColor(input: string): Color {
  let text = input.trim().toLowerCase();
  if (text.length > 200) throw new Error('颜色值过长。');
  text = names[text] || text;
  const hex = text.match(/^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length < 5) digits = [...digits].map(char => char + char).join('');
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1 };
  }
  const match = text.match(/^(rgb|rgba|hsl|hsla)\((.*)\)$/);
  if (!match) throw new Error('请输入 HEX、rgb()/rgba() 或 hsl()/hsla() 颜色。');
  const body = match[2].trim();
  let channels: string[], alpha = '1';
  if (body.includes(',')) {
    if (body.includes('/')) throw new Error('请勿混合逗号和斜线语法。');
    const parts = body.split(',').map(value => value.trim());
    if (parts.length !== 3 && parts.length !== 4) throw new Error('颜色需要三个分量和可选透明度。');
    channels = parts.slice(0, 3); alpha = parts[3] ?? '1';
  } else {
    const parts = body.split('/');
    if (parts.length > 2) throw new Error('透明度格式无效。');
    channels = parts[0].trim().split(/\s+/); alpha = parts[1]?.trim() ?? '1';
    if (channels.length !== 3) throw new Error('颜色需要三个分量。');
  }
  const a = numeric(alpha, 1);
  if (match[1].startsWith('rgb')) return { r: numeric(channels[0], 255), g: numeric(channels[1], 255), b: numeric(channels[2], 255), a };
  const angle = channels[0].match(/^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/);
  if (!angle) throw new Error('HSL 色相需为数字或 deg / turn / rad / grad。');
  const multipliers: Record<string, number> = { deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 };
  return fromHsl(Number(angle[1]) * multipliers[angle[2] || 'deg'], numeric(channels[1], 1, true), numeric(channels[2], 1, true), a);
}
export function hexColor(color: Color, includeAlpha = color.a < 1): string {
  const byte = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return ('#' + byte(color.r) + byte(color.g) + byte(color.b) + (includeAlpha ? byte(color.a * 255) : '')).toUpperCase();
}
export function colorFormats(color: Color) {
  const hsl = toHsl(color), [r, g, b] = [color.r, color.g, color.b].map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), k = 1 - max;
  const pct = (value: number) => `${rounded(value * 100)}%`;
  const alpha = color.a < 1 ? ` / ${pct(color.a)}` : '';
  const cmyk = k === 1 ? [0, 0, 0, 1] : [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  return {
    HEX: hexColor(color), HEXA: hexColor(color, true),
    RGB: `rgb(${rounded(color.r)} ${rounded(color.g)} ${rounded(color.b)}${alpha})`,
    HSL: `hsl(${rounded(hsl.h)} ${pct(hsl.s)} ${pct(hsl.l)}${alpha})`,
    HSV: `${rounded(hsl.h)}°, ${pct(max === 0 ? 0 : (max - min) / max)}, ${pct(max)}`,
    CMYK: cmyk.map(pct).join(', '),
  };
}
export function composite(foreground: Color, background: Color): Color {
  const a = foreground.a + background.a * (1 - foreground.a);
  const channel = (key: 'r' | 'g' | 'b') => a === 0 ? 0 : (foreground[key] * foreground.a + background[key] * background.a * (1 - foreground.a)) / a;
  return { r: channel('r'), g: channel('g'), b: channel('b'), a };
}
const linearize = (channel: number) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const delinearize = (channel: number) => channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
export function luminance(color: Color): number {
  const [r, g, b] = [color.r, color.g, color.b].map(value => linearize(value / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastReport(foreground: Color, background: Color) {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const bg = composite(background, white), fg = composite(foreground, bg);
  const a = luminance(fg), b = luminance(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return { ratio, foreground: fg, background: bg, aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7, aaaLarge: ratio >= 4.5, ui: ratio >= 3 };
}
export function readableInk(color: Color): string {
  const bg = composite(color, { r: 255, g: 255, b: 255, a: 1 });
  return luminance(bg) > 0.179 ? '#000000' : '#FFFFFF';
}
export function mixColors(start: Color, end: Color, amount: number, space = 'srgb'): Color {
  const t = clamp(amount), a = start.a * (1 - t) + end.a * t;
  const channel = (key: 'r' | 'g' | 'b') => {
    const first = start[key] / 255, second = end[key] / 255;
    const mixed = a === 0 ? 0 : ((space === 'linear' ? linearize(first) : first) * start.a * (1 - t) + (space === 'linear' ? linearize(second) : second) * end.a * t) / a;
    return (space === 'linear' ? delinearize(mixed) : mixed) * 255;
  };
  return { r: channel('r'), g: channel('g'), b: channel('b'), a };
}
export function harmonyColors(base: Color, mode: string): Color[] {
  const { h, s, l } = toHsl(base);
  if (mode === 'mono') return [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map(light => fromHsl(h, s, light, base.a));
  const offsets: Record<string, number[]> = { analogous: [-30, -15, 0, 15, 30], complementary: [0, 180], triadic: [0, 120, 240], split: [0, 150, 210], tetradic: [0, 90, 180, 270] };
  return (offsets[mode] || offsets.analogous).map(offset => fromHsl(h + offset, s, l, base.a));
}
export const shadeLabels = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
export function shadeColors(base: Color): Color[] {
  const { h, s } = toHsl(base);
  return [0.97, 0.93, 0.85, 0.75, 0.64, 0.5, 0.4, 0.3, 0.22, 0.14, 0.07].map(l => fromHsl(h, s, l, base.a));
}
export function paletteExport(colors: Color[], labels?: string[], format = 'css'): string {
  const entries = colors.map((color, index) => [`color-${labels?.[index] || index + 1}`, hexColor(color)]);
  return format === 'json' ? JSON.stringify(Object.fromEntries(entries), null, 2) : ':root {\n' + entries.map(([name, value]) => `  --${name}: ${value};`).join('\n') + '\n}';
}
export function gradientCss(colors: Color[], angle = 135, type = 'linear'): string {
  if (colors.length < 2 || colors.length > 5 || !Number.isFinite(angle)) throw new Error('渐变需要 2–5 个有效色标和有效角度。');
  const stops = colors.map((color, index) => `${hexColor(color)} ${rounded(index / (colors.length - 1) * 100)}%`).join(', ');
  return type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${rounded(angle)}deg, ${stops})`;
}
export function colorTransform(id: ColorToolId, input: string, options: Record<string, string>): string {
  const base = parseColor(input);
  if (id === 'color-picker' || id === 'color-convert') return JSON.stringify(colorFormats(base), null, 2);
  if (id === 'color-palette') return paletteExport(harmonyColors(base, options.mode || 'analogous'), undefined, options.format);
  const second = parseColor(options.second || '#FFFFFF');
  if (id === 'color-contrast') {
    const report = contrastReport(base, second);
    return JSON.stringify({ ratio: rounded(report.ratio, 4), AA: report.aa, AALarge: report.aaLarge, AAA: report.aaa, AAALarge: report.aaaLarge, UI: report.ui, note: '透明背景叠加白色；按未四舍五入的比值判定。' }, null, 2);
  }
  if (id === 'color-gradient') return `background: ${gradientCss([base, second], Number(options.angle ?? 135), options.type)};`;
  const amount = Number(options.amount ?? 50);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) throw new Error('混合比例需在 0–100 之间。');
  return JSON.stringify(colorFormats(mixColors(base, second, amount / 100, options.space)), null, 2);
}
