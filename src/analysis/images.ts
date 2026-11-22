import type { Opt } from './tabular';
export const imageTools = new Set(['pixel-diff', 'image-compress', 'favicon-kit', 'qr-code']);
export const faviconSizes = [16, 32, 48, 180, 192, 512] as const;
export type ImageReport = { summary: string; files: { name: string; blob: Blob }[]; text?: string };
export function canvas(w: number, h: number) {
  if (!w || !h || w * h > 24_000_000) throw Error('单幅图片上限为 2400 万像素');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const encode = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(Error('图像编码失败'))), type, quality),
  );
async function load(file: File) {
  if (file.size > 64 * 1024 * 1024) throw Error('图片不得超过 64 MiB');
  const img = await createImageBitmap(file);
  try {
    const c = canvas(img.width, img.height);
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  } finally {
    img.close();
  }
}
export async function imageReport(id: string, file: File, o: Opt, right?: File): Promise<ImageReport> {
  const source = await load(file),
    w = source.width,
    h = source.height;
  if (id === 'qr-code') {
    const { default: read } = await import('jsqr'),
      pixels = source.getContext('2d')!.getImageData(0, 0, w, h),
      code = read(pixels.data, w, h);
    if (!code) throw Error('没有识别到二维码，请选择边缘完整的清晰原图');
    return { summary: '已识别二维码', text: code.data, files: [] };
  }
  if (id === 'pixel-diff') {
    if (!right) throw Error('请选择第二张截图');
    const other = await load(right);
    if (w !== other.width || h !== other.height)
      throw Error('图片尺寸不同：' + w + '×' + h + ' 与 ' + other.width + '×' + other.height);
    const { default: pixelmatch } = await import('pixelmatch');
    const a = source.getContext('2d')!.getImageData(0, 0, w, h),
      b = other.getContext('2d')!.getImageData(0, 0, w, h),
      result = canvas(w, h),
      ctx = result.getContext('2d')!,
      diff = ctx.createImageData(w, h);
    const count = pixelmatch(a.data, b.data, diff.data, w, h, {
      threshold: Number(o.tolerance ?? 0.1),
      includeAA: o.aa === 'on',
    });
    ctx.putImageData(diff, 0, 0);
    return {
      summary: count.toLocaleString() + ' 个不同像素 · ' + ((count / (w * h)) * 100).toFixed(4) + '%',
      files: [{ name: 'diff.png', blob: await encode(result) }],
    };
  }
  if (id === 'image-compress') {
    const ext = o.format || 'webp',
      type = 'image/' + ext,
      chosen = Number(o.quality ?? 80);
    if (ext === 'jpeg') {
      const ctx = source.getContext('2d')!;
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    const files = await Promise.all(
      [...new Set([Math.max(1, chosen - 20), chosen, Math.min(100, chosen + 10)])].map(async (q) => ({
        name: 'quality-' + q + '.' + ext,
        blob: await encode(source, type, q / 100),
      })),
    );
    return { summary: w + ' × ' + h + ' · 原图 ' + file.size.toLocaleString() + ' 字节', files };
  }
  const { default: JSZip } = await import('jszip'),
    zip = new JSZip(),
    images = new Map<number, Uint8Array<ArrayBuffer>>();
  for (const size of faviconSizes) {
    const c = canvas(size, size),
      ctx = c.getContext('2d')!,
      ratio = size / Math.max(w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, (size - w * ratio) / 2, (size - h * ratio) / 2, w * ratio, h * ratio);
    const data = new Uint8Array(await (await encode(c)).arrayBuffer());
    images.set(size, data);
    zip.file('icon-' + size + '.png', data);
  }
  const sizes = [16, 32, 48],
    head = new Uint8Array(6 + 16 * sizes.length),
    view = new DataView(head.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, sizes.length, true);
  let offset = head.length;
  sizes.forEach((size, i) => {
    const pos = 6 + 16 * i,
      bytes = images.get(size)!;
    head[pos] = size;
    head[pos + 1] = size;
    view.setUint16(pos + 4, 1, true);
    view.setUint16(pos + 6, 32, true);
    view.setUint32(pos + 8, bytes.length, true);
    view.setUint32(pos + 12, offset, true);
    offset += bytes.length;
  });
  const ico = new Uint8Array(offset);
  ico.set(head);
  offset = head.length;
  for (const size of sizes) {
    const x = images.get(size)!;
    ico.set(x, offset);
    offset += x.length;
  }
  zip.file('favicon.ico', ico);
  zip.file(
    'site.webmanifest',
    JSON.stringify(
      {
        name: o.name || '应用',
        icons: [192, 512].map((n) => ({ src: 'icon-' + n + '.png', sizes: n + 'x' + n, type: 'image/png' })),
      },
      null,
      2,
    ),
  );
  const text =
    '<link rel="icon" href="favicon.ico">\n<link rel="apple-touch-icon" href="icon-180.png">\n<link rel="manifest" href="site.webmanifest">';
  zip.file('links.html', text);
  return {
    summary: faviconSizes.length + ' 种 PNG 尺寸 · 3 尺寸 ICO · Web Manifest',
    files: [{ name: 'site-icons.zip', blob: await zip.generateAsync({ type: 'blob' }) }],
    text,
  };
}
