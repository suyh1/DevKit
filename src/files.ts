declare global {
  interface Window { devkitDesktop?: {
    platform?: string;
    openLanHost?: (address: string, module: 'jar' | 'nginx') => Promise<{ error?: string }>;
    lanHosts?: (action: string, value?: unknown) => Promise<{ data?: unknown; error?: string }>;
    saveText: (text: string, filename: string) => Promise<string>;
    onCloseRequest: (listener: (intent: 'close' | 'reload' | 'choose') => void) => () => void;
    answerClose: (allow: boolean) => void;
    closeSettings: (action: 'get' | 'set', value?: 'ask' | 'tray' | 'quit') => Promise<{ closeAction: 'ask' | 'tray' | 'quit' }>;
    chooseClose: (action: 'cancel' | 'tray' | 'quit', remember: boolean) => Promise<void>;
  } }
}

export async function saveText(text: string, filename: string): Promise<string> {
  if (window.devkitDesktop) return window.devkitDesktop.saveText(text, filename);
  return downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}

export function downloadBlob(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `已请求浏览器下载 ${filename}`;
}

export async function readText(file: File): Promise<{ text: string; encoding: string }> {
  if (file.size > 8_000_000) throw new Error('请选择不超过 8 MB 的文本文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else if (bytes.includes(0)) throw new Error('文件包含二进制内容，请选择 UTF-8 或带 BOM 的 UTF-16 文本。');
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('无法读取文件编码，请先转换为 UTF-8 或带 BOM 的 UTF-16。'); }
  if (text.length > 2_000_000) throw new Error('文本超过 2,000,000 字符限制。');
  return { text, encoding: encoding.toUpperCase() };
}
