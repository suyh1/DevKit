import { bitmapLimit } from './clipboard-formats';

function pixelBytes(width: number, height: number) {
  const size = width * height * 4;
  if (!Number.isInteger(size) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || size + 124 > bitmapLimit) throw new Error('位图尺寸超过限制。');
  return size;
}

export function encodeDib(width: number, height: number, rgba: Uint8ClampedArray) {
  const size = pixelBytes(width, height);
  if (rgba.length !== size) throw new Error('像素数据不完整。');
  const bytes = new Uint8Array(124 + size), view = new DataView(bytes.buffer);
  view.setUint32(0, 124, true);
  view.setInt32(4, width, true); view.setInt32(8, -height, true);
  view.setUint16(12, 1, true); view.setUint16(14, 32, true);
  view.setUint32(16, 3, true); view.setUint32(20, size, true);
  [0xff0000, 0xff00, 0xff, 0xff000000, 0x73524742].forEach((v, i) => view.setUint32(40 + i * 4, v, true));
  for (let i = 0; i < size; i += 4) {
    bytes[124+i] = rgba[i+2]; bytes[125+i] = rgba[i+1]; bytes[126+i] = rgba[i]; bytes[127+i] = rgba[i+3];
  }
  return bytes;
}

export function decodeDib(bytes: Uint8Array) {
  if (bytes.length < 124 || bytes.length > bitmapLimit) throw new Error('位图数据长度无效。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(4, true), rows = view.getInt32(8, true), height = Math.abs(rows);
  const size = pixelBytes(width, height), bits = view.getUint16(14, true), compression = view.getUint32(16, true);
  if (view.getUint32(0, true) !== 124 || view.getUint16(12, true) !== 1 || ![24, 32].includes(bits) ||
      !(compression === 0 || compression === 3 && bits === 32 && [0xff0000, 0xff00, 0xff].every((v,i) => view.getUint32(40+i*4,true) === v)) ||
      view.getUint32(32, true) || view.getUint32(116, true)) throw new Error('远端位图的像素格式不受支持。');
  const stride = Math.ceil(width * bits / 32) * 4;
  if (124 + stride * height > bytes.length) throw new Error('远端位图数据不完整。');
  const alpha = compression === 3 && view.getUint32(52, true) === 0xff000000;
  const rgba = new Uint8ClampedArray(size);
  for (let y = 0; y < height; y++) {
    let src = 124 + stride * (rows < 0 ? y : height - 1 - y), dst = width * y * 4;
    for (let x = 0; x < width; x++, src += bits / 8, dst += 4) {
      rgba[dst] = bytes[src+2]; rgba[dst+1] = bytes[src+1]; rgba[dst+2] = bytes[src]; rgba[dst+3] = alpha ? bytes[src+3] : 255;
    }
  }
  return { rgba, width, height };
}

export async function pngToDib(blob: Blob) {
  if (blob.size > bitmapLimit) throw new Error('PNG 图片超过 40 MiB。');
  const header = new DataView(await blob.slice(0, 24).arrayBuffer());
  if (header.byteLength < 24 || header.getUint32(0) !== 0x89504e47 || header.getUint32(12) !== 0x49484452) throw new Error('需要 PNG 截图。');
  pixelBytes(header.getUint32(16), header.getUint32(20));
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return encodeDib(image.width, image.height, ctx.getImageData(0, 0, image.width, image.height).data);
  } finally { image.close(); }
}

export function dibToPng(bytes: Uint8Array) {
  const { rgba, width, height } = decodeDib(bytes);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法编码截图。')), 'image/png'));
}
