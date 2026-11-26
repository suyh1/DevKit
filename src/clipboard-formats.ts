export const desktopTextLimit = 4 * 1024 * 1024;
export const gatewayTextLimit = 256 * 1024;
export const bitmapLimit = 40 * 1024 * 1024;
export const transferLimit = 128 * 1024 * 1024;

export type ClipboardProtocol = 'desktop-vnc' | 'web-vnc' | 'web-rdp';
export function checkText(text: string, protocol: ClipboardProtocol) {
  const length = new TextEncoder().encode(text).length;
  if (protocol === 'desktop-vnc') return length > desktopTextLimit ? 'VNC 文本最多 4 MiB。' : '';
  if (length + 1 > gatewayTextLimit) return '网关的 UTF-8 剪贴板缓冲区最多 256 KiB（含结束符）。';
  if (protocol === 'web-rdp' && (text.length + 1) * 2 > gatewayTextLimit) return 'RDP 文本转换为 UTF-16 后超过 256 KiB，请分段粘贴或作为文件发送。';
  return '';
}
