import type { Options } from './tools';

export type ExtendedToolId = 'xml' | 'gzip' | 'ipv4' | 'chmod' | 'ulid' | 'text-stats';
export const extendedDefaults: Record<ExtendedToolId, Options> = {
  xml: { mode: 'format', indent: '2' }, gzip: { mode: 'compress' }, ipv4: {}, chmod: {},
  ulid: { mode: 'generate', timestamp: '' }, 'text-stats': {},
};
export const extendedTools = [
  { id: 'xml' as const, name: 'XML 格式化', english: 'XML Formatter', category: '结构化数据', description: '格式化或压缩 XML，保留注释、CDATA 与 xml:space。拒绝 DTD / ENTITY；不执行内容，不校验 XSD。', sample: '<?xml version="1.0"?><users><!-- 本地配置 --><user id="1"><name>张三</name><role>developer</role></user></users>' },
  { id: 'gzip' as const, name: 'GZip 压缩与解压', english: 'GZip Text Codec', category: '编码与解析', description: 'UTF-8 文本与 GZip Base64 双向转换，流式解压最多 4,000,000 字节；不处理 ZIP 或任意二进制文件。', sample: '你好，DevKit！\n离线压缩，离线解压。\n你好，DevKit！' },
  { id: 'ipv4' as const, name: 'IPv4 子网计算', english: 'IPv4 Subnet Calculator', category: '时间与数值', description: '由 IPv4 / CIDR 或连续子网掩码计算网络、广播、主机范围。/31 使用点对点规则，/32 为单个地址；不访问网络。', sample: '192.168.10.42/24' },
  { id: 'chmod' as const, name: 'chmod 权限换算', english: 'Unix Permissions', category: '安全与标识', description: '通过权限矩阵、八进制或 rwx 输入换算权限，解释 owner / group / other 与 setuid、setgid、sticky。只计算，不执行命令或修改文件。', sample: '4755' },
  { id: 'ulid' as const, name: 'ULID 生成与解析', english: 'ULID Generator / Decoder', category: '安全与标识', description: '生成 1–1,000 个 ULID，同批次单调递增；或逐行解析标识的毫秒时间与随机段。时间可见，不用于密码或令牌。', sample: '5' },
  { id: 'text-stats' as const, name: '文本统计', english: 'Text Analyzer', category: '文本与匹配', description: '统计 UTF-8 字节、UTF-16 单元、Unicode 码点、可见字符簇、单词与行数，正确处理中文、emoji 和 CRLF。', sample: 'Hello, DevKit!\r\n你好，开发者 👨‍👩‍👧‍👦\r\n\r\n离线处理，不上传文本。' },
];
export function isExtendedTool(id: string): id is ExtendedToolId { return Object.hasOwn(extendedDefaults, id); }
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

async function xml(input: string, options: Options) {
  if (input.length > 200_000) throw new Error('XML 最多支持 200,000 字符。');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(input)) throw new Error('不支持 DTD / ENTITY 声明，请移除后重试。');
  if (options.mode && !['format', 'compact'].includes(options.mode)) throw new Error('请选择格式化或压缩。');
  const { default: format } = await import('xml-formatter');
  const config = { strictMode: true, throwOnFailure: true, collapseContent: true, lineSeparator: '\n' };
  try {
    return options.mode === 'compact' ? format.minify(input, config) : format(input, { ...config, indentation: options.indent === '4' ? '    ' : '  ' });
  } catch (error) { throw new Error(`XML 无法解析：${error instanceof Error ? error.message : String(error)}`); }
}

function encode64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
async function gzip(input: string, options: Options) {
  const decompress = options.mode === 'decompress';
  if (options.mode && !['compress', 'decompress'].includes(options.mode)) throw new Error('请选择压缩或解压。');
  let bytes: Uint8Array<ArrayBuffer>;
  if (decompress) {
    const value = input.replace(/\s/g, '');
    if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('请输入带完整填充的标准 GZip Base64。');
    bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('输入不是 GZip 数据。');
  } else bytes = new TextEncoder().encode(input);
  // Bound native decompressor work per write as well as the collected output.
  // Enqueuing all compressed bytes at once could expand a bomb before JS reads it.
  let sourcePosition = 0;
  const source = new ReadableStream<BufferSource>({ pull(controller) {
    if (sourcePosition >= bytes.length) { controller.close(); return; }
    const end = Math.min(sourcePosition + 1024, bytes.length);
    controller.enqueue(bytes.subarray(sourcePosition, end)); sourcePosition = end;
  } }, { highWaterMark: 0 });
  const reader = source.pipeThrough(decompress ? new DecompressionStream('gzip') : new CompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4_000_000) throw new Error('GZip 结果超过 4,000,000 字节，已停止处理。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw new Error(`GZip 处理失败：${error instanceof Error ? error.message : '数据损坏或不受支持'}`);
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { output.set(chunk, position); position += chunk.length; }
  try { return decompress ? new TextDecoder('utf-8', { fatal: true }).decode(output) : encode64(output); }
  catch { throw new Error('解压结果不是有效 UTF-8 文本。'); }
}

function parseIPv4(input: string): number {
  const parts = input.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) throw new Error('IPv4 必须包含四段 0–255 的十进制数，不允许前导零。');
  return parts.reduce((result, part) => result * 256 + Number(part), 0);
}
const address = (value: number) => [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
function ipv4(input: string) {
  const parts = input.trim().split('/');
  if (parts.length !== 2) throw new Error('请输入 IPv4/前缀，例如 192.168.1.42/24 或 192.168.1.42/255.255.255.0。');
  const ip = parseIPv4(parts[0]);
  let prefix: number;
  if (parts[1].includes('.')) {
    const mask = parseIPv4(parts[1]), inverse = 0xffffffff - mask;
    if ((inverse & (inverse + 1)) !== 0) throw new Error('子网掩码的二进制 1 必须连续。');
    prefix = 32 - Math.log2(inverse + 1);
  } else {
    if (!/^(0|[1-9]\d?)$/.test(parts[1]) || Number(parts[1]) > 32) throw new Error('CIDR 前缀必须为 0–32。');
    prefix = Number(parts[1]);
  }
  const count = 2 ** (32 - prefix), mask = 2 ** 32 - count, network = (ip & mask) >>> 0, last = network + count - 1;
  return pretty({ address: address(ip), cidr: `${address(network)}/${prefix}`, prefix, netmask: address(mask), wildcard: address(count - 1), network: address(network), broadcast: prefix >= 31 ? null : address(last), firstHost: address(network + (prefix >= 31 ? 0 : 1)), lastHost: address(last - (prefix >= 31 ? 0 : 1)), totalAddresses: count, usableHosts: prefix >= 31 ? count : count - 2, note: prefix === 31 ? '/31：RFC 3021 点对点链路，两端地址均可用，无广播地址。' : prefix === 32 ? '/32：单个主机地址，无广播地址。' : '主机范围排除网络地址与广播地址；可路由性取决于网络环境。' });
}

function chmod(input: string) {
  const text = input.trim();
  let value: number;
  if (/^[0-7]{3,4}$/.test(text)) value = parseInt(text, 8);
  else {
    const symbols = text.length === 10 && /^[-dlcbps]/.test(text) ? text.slice(1) : text;
    if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(symbols)) throw new Error('请输入 3–4 位八进制权限，或 rwxr-xr-x 等 9 位权限字符串（可带文件类型前缀）。');
    value = 0;
    for (let group = 0; group < 3; group++) {
      const [read, write, execute] = symbols.slice(group * 3, group * 3 + 3);
      const bits = (read === 'r' ? 4 : 0) + (write === 'w' ? 2 : 0) + (/[xst]/.test(execute) ? 1 : 0);
      value |= bits << (6 - group * 3);
      if (/[sStT]/.test(execute)) value |= 1 << (11 - group);
    }
  }
  const groups = ['owner', 'group', 'other'].map((role, index) => {
    const bits = (value >> (6 - index * 3)) & 7, special = !!(value & (1 << (11 - index)));
    return { role, read: !!(bits & 4), write: !!(bits & 2), execute: !!(bits & 1), symbolic: (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (special ? index === 2 ? bits & 1 ? 't' : 'T' : bits & 1 ? 's' : 'S' : bits & 1 ? 'x' : '-') };
  });
  const octal = value.toString(8).padStart(4, '0');
  return pretty({ octal, symbolic: groups.map(group => group.symbolic).join(''), groups, special: { setuid: !!(value & 0o4000), setgid: !!(value & 0o2000), sticky: !!(value & 0o1000) }, command: `chmod ${octal} -- <path>`, note: '仅供换算参考，不包含 ACL、文件能力或操作系统额外权限规则。命令不会执行。' });
}

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, width: number) {
  let output = '';
  for (let index = 0; index < width; index++) { output = alphabet[Number(value & 31n)] + output; value >>= 5n; }
  return output;
}
function ulid(input: string, options: Options) {
  if (options.mode === 'parse') {
    const lines = input.trim().split(/\r?\n/);
    if (lines.length > 1000) throw new Error('最多解析 1,000 个 ULID。');
    return pretty(lines.map(line => {
      const id = line.trim().toUpperCase();
      if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) throw new Error(`无效 ULID：${line.slice(0, 80)}。必须为 26 位 Crockford Base32，首位不大于 7。`);
      let timestamp = 0;
      for (const char of id.slice(0, 10)) timestamp = timestamp * 32 + alphabet.indexOf(char);
      return { ulid: id, timestamp, utc: new Date(timestamp).toISOString(), randomness: id.slice(10) };
    }));
  }
  if (options.mode && options.mode !== 'generate') throw new Error('请选择生成或解析。');
  if (!/^\d{1,4}$/.test(input.trim()) || Number(input) < 1 || Number(input) > 1000) throw new Error('生成数量必须为 1–1,000。');
  const timestamp = options.timestamp?.trim() || String(Date.now());
  if (!/^\d+$/.test(timestamp) || Number(timestamp) > 281474976710655) throw new Error('毫秒时间戳必须为 0–281474976710655 的整数。');
  const time = base32(BigInt(timestamp), 10);
  let random = crypto.getRandomValues(new Uint8Array(10)).reduce((result, byte) => (result << 8n) | BigInt(byte), 0n);
  const result: string[] = [];
  for (let index = 0; index < Number(input); index++) {
    if (random >= 1n << 80n) throw new Error('本批次随机段溢出，请重新生成。');
    result.push(time + base32(random++, 16));
  }
  return result.join('\n');
}

function textStats(input: string) {
  const lines = input ? input.split(/\r\n|[\r\n]/) : [];
  const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
  const words = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  let codePoints = 0, visible = 0, wordCount = 0, whitespace = 0;
  for (const char of input) { codePoints++; if (/\s/u.test(char)) whitespace++; }
  for (const _segment of graphemes.segment(input)) visible++;
  for (const segment of words.segment(input)) if (segment.isWordLike) wordCount++;
  return pretty({ utf8Bytes: new TextEncoder().encode(input).length, utf16Units: input.length, unicodeCodePoints: codePoints, graphemeClusters: visible, words: wordCount, lines: lines.length, nonEmptyLines: lines.filter(line => line.trim()).length, whitespaceCodePoints: whitespace, lineEndings: { crlf: (input.match(/\r\n/g) || []).length, lf: (input.match(/(?<!\r)\n/g) || []).length, cr: (input.match(/\r(?!\n)/g) || []).length }, note: '行数按 CRLF / LF / CR 分隔，末尾换行产生空行，空文本为 0 行；字符簇包含空白与换行；单词按 zh-CN 分词，结果取决于运行时 ICU。' });
}

export async function extendedTransform(id: ExtendedToolId, input: string, options: Options) {
  switch (id) {
    case 'xml': return xml(input, options);
    case 'gzip': return gzip(input, options);
    case 'ipv4': return ipv4(input);
    case 'chmod': return chmod(input);
    case 'ulid': return ulid(input, options);
    case 'text-stats': return textStats(input);
  }
}
