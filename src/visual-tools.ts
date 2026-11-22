import qrcode from 'qrcode-generator';
import { defaultOptions, type Options } from './tools';

export function makeQr(text: string, options: Options) {
  if (!text) throw new Error('请输入文本或链接。');
  const bytes = new TextEncoder().encode(text);
  const capacity = '内容超过所选纠错级别的容量，请缩短文本或降低纠错级别。';
  if (bytes.length > 2953) throw new Error(capacity);
  const level = options.level ?? 'M';
  if (!['L', 'M', 'Q', 'H'].includes(level)) throw new Error('请选择有效的纠错级别。');
  const qr = qrcode(0, level as 'L' | 'M' | 'Q' | 'H');
  // The library's default byte encoder takes the low eight bits of each character.
  qr.addData(String.fromCharCode(...bytes), 'Byte');
  try { qr.make(); } catch { throw new Error(capacity); }
  return qr;
}

const flexChoices = {
  direction: ['row', 'row-reverse', 'column', 'column-reverse'],
  wrap: ['nowrap', 'wrap', 'wrap-reverse'],
  justify: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  align: ['stretch', 'flex-start', 'center', 'flex-end'],
};


export function flexStyle(options: Options) {
  const resolved = { ...defaultOptions['css-flex'], ...options };
  for (const [key, choices] of Object.entries(flexChoices)) {
    if (!choices.includes(resolved[key as keyof typeof flexChoices])) throw new Error('请选择有效的布局参数。');
  }
  for (const [key, min, max] of [['gap', 0, 100], ['width', 120, 1200]] as const) {
    const n = Number(resolved[key]);
    if (!resolved[key].trim() || !Number.isInteger(n) || n < min || n > max)
      throw new Error((key === 'gap' ? '间距' : '宽度') + '范围为 ' + min + '–' + max + ' px。');
  }
  return { display: 'flex', flexDirection: resolved.direction, flexWrap: resolved.wrap,
    justifyContent: resolved.justify, alignItems: resolved.align, gap: resolved.gap + 'px', width: resolved.width + 'px', height: '200px' };
}
export function flexCss(options: Options) {
  const declarations = Object.entries(flexStyle(options)).map(([key, value]) =>
    '  ' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ': ' + value + ';');
  return ['.container {', ...declarations, '}'].join('\n');
}
