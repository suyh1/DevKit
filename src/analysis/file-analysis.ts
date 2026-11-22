import { largeReport, largeReports } from './large-reports';
import { csv, type Opt } from './tabular';
export type FileReport = {
  summary: string;
  rows: string;
  data?: string;
  ext?: string;
  blob?: Blob;
  choices?: string[];
  columnNames?: string[];
  sourceText?: string;
};
export type ArchiveEntry = { name: string; size: number; packed: number; crc: number };
export function archiveEntries(bytes: ArrayBuffer) {
  const v = new DataView(bytes),
    data = new Uint8Array(bytes),
    entries: ArchiveEntry[] = [];
  let e = bytes.byteLength - 22;
  for (; e >= Math.max(0, bytes.byteLength - 65557); e--)
    if (v.getUint32(e, true) === 0x06054b50 && e + 22 + v.getUint16(e + 20, true) === bytes.byteLength) break;
  if (e < 0 || e < bytes.byteLength - 65557 || v.getUint32(e, true) !== 0x06054b50)
    throw Error('没有有效的 ZIP 中央目录');
  const count = v.getUint16(e + 10, true);
  if (count === 65535 || v.getUint16(e + 4, true) !== 0) throw Error('暂不支持 ZIP64 或分卷归档');
  let at = v.getUint32(e + 16, true);
  for (let i = 0; i < count; i++) {
    if (at + 46 > e || v.getUint32(at, true) !== 0x02014b50) throw Error('中央目录损坏');
    const len = v.getUint16(at + 28, true),
      extra = v.getUint16(at + 30, true),
      comment = v.getUint16(at + 32, true),
      end = at + 46 + len;
    if (end + extra + comment > e) throw Error('目录项超出文件范围');
    const name = new TextDecoder().decode(data.subarray(at + 46, end));
    if (!name.endsWith('/'))
      entries.push({
        name,
        crc: v.getUint32(at + 16, true),
        packed: v.getUint32(at + 20, true),
        size: v.getUint32(at + 24, true),
      });
    at = end + extra + comment;
  }
  return entries;
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
async function zip(file: File, right?: File, jar = false): Promise<FileReport> {
  const bytes = await file.arrayBuffer(),
    a = archiveEntries(bytes);
  function groups(entries: ArchiveEntry[], base: boolean) {
    const result = new Map<string, ArchiveEntry[]>();
    for (const e of entries) {
      const key = base ? e.name.split('/').at(-1)! : e.name;
      const group = result.get(key) ?? [];
      group.push(e);
      result.set(key, group);
    }
    return result;
  }
  const names = groups(a, true),
    manifest = a.find((e) => e.name.toUpperCase() === 'META-INF/MANIFEST.MF');
  let summary = a.length + ' 个文件 · 展开后 ' + a.reduce((s, x) => s + x.size, 0).toLocaleString() + ' 字节';
  if (jar && manifest && manifest.size <= 1048576) {
    const { default: JSZip } = await import('jszip'),
      pack = await JSZip.loadAsync(bytes);
    const text = (await pack.file(manifest.name)?.async('string'))?.replace(/\r?\n /g, '') ?? '';
    summary += '\n' + text.trim();
  }
  if (!right)
    return {
      summary,
      rows: csv([
        ['路径', '字节', '压缩字节', 'CRC32', '分类', '同名文件数'],
        ...a.map((e) => [
          e.name,
          e.size,
          e.packed,
          e.crc.toString(16).padStart(8, '0'),
          jar && /\.jar$/i.test(e.name) ? '嵌套依赖' : e === manifest ? 'Manifest' : '资源',
          names.get(e.name.split('/').at(-1)!)!.length,
        ]),
      ]),
    };
  const left = groups(a, false),
    b = groups(archiveEntries(await right.arrayBuffer()), false),
    rows: unknown[][] = [['状态', '路径', '旧字节', '新字节', '增长字节']];
  for (const k of new Set([...left.keys(), ...b.keys()])) {
    const x = left.get(k) ?? [],
      y = b.get(k) ?? [],
      before = x.reduce((s, e) => s + e.size, 0),
      after = y.reduce((s, e) => s + e.size, 0);
    const status =
      x.length > 1 || y.length > 1
        ? '重复路径'
        : !x.length
          ? '新增'
          : !y.length
            ? '删除'
            : x[0].crc !== y[0].crc || before !== after
              ? '变更'
              : '';
    if (status) rows.push([status, k, before, after, after - before]);
  }
  return { summary: rows.length - 1 + ' 项差异', rows: csv(rows) };
}
export async function analyzeFile(id: string, file: File, o: Opt, right?: File): Promise<FileReport> {
  if (file.size > 128 * 1024 * 1024 || (right?.size ?? 0) > 128 * 1024 * 1024)
    throw Error('单个文件上限 128 MiB');
  if (largeReports.has(id)) return largeReport(id, file, right, o);
  if (id === 'zip-inventory' || id === 'jar-inspect') return zip(file, right, id === 'jar-inspect');
  const bytes = await file.arrayBuffer(),
    raw = new Uint8Array(bytes);
  if (id === 'file-signature') {
    const { fileTypeFromBuffer } = await import('file-type'),
      type = await fileTypeFromBuffer(raw).catch(() => undefined);
    const ext = file.name.split('.').at(-1)?.toLowerCase() ?? '',
      aliases: Record<string, string[]> = {
        jpg: ['jpeg', 'jfif'],
        tif: ['tiff'],
        zip: ['jar', 'war', 'ear'],
        exe: ['dll'],
      };
    return {
      summary: type
        ? type.mime +
          ' · ' +
          (ext === type.ext || aliases[type.ext]?.includes(ext) ? '扩展名匹配' : '扩展名与签名不符')
        : '未识别签名',
      rows: csv([
        ['偏移', '十六进制（前 256 字节）'],
        ...Array.from({ length: Math.ceil(Math.min(raw.length, 256) / 16) }, (_, i) => [
          i * 16,
          hex(raw.slice(i * 16, i * 16 + 16)),
        ]),
      ]),
    };
  }
  if (id === 'encoding-repair') {
    const bom =
      raw[0] === 255 && raw[1] === 254
        ? 'utf-16le'
        : raw[0] === 254 && raw[1] === 255
          ? 'utf-16be'
          : raw[0] === 239 && raw[1] === 187 && raw[2] === 191
            ? 'utf-8'
            : '';
    let encoding = o.encoding || 'auto';
    if (encoding === 'auto') {
      encoding = bom || 'utf-8';
      if (!bom)
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(raw);
        } catch {
          encoding = 'gb18030';
        }
    }
    let text = new TextDecoder(encoding).decode(raw);
    if (o.repair === 'gbk') {
      const { default: iconv } = await import('iconv-lite');
      const recovered = iconv.encode(text, 'gb18030');
      if (iconv.decode(recovered, 'gb18030') !== text) throw Error('文本无法无损还原为 GB18030 字节');
      text = new TextDecoder('utf-8', { fatal: true }).decode(recovered);
    }
    if (o.repair === 'latin1') {
      if (Array.from(text).some((c) => c.charCodeAt(0) > 255))
        throw Error('文本含无法还原为 Latin-1 字节的字符');
      text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(text, (c) => c.charCodeAt(0)));
    }
    const dest = o.dest || 'utf-8';
    let out: Uint8Array<ArrayBuffer>;
    if (dest === 'utf-8') out = new TextEncoder().encode(text);
    else if (dest === 'gb18030') {
      const { default: iconv } = await import('iconv-lite');
      out = new Uint8Array(iconv.encode(text, 'gb18030'));
    } else {
      out = new Uint8Array(2 + 2 * text.length);
      const view = new DataView(out.buffer),
        le = dest === 'utf-16le';
      view.setUint16(0, 0xfeff, le);
      for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), le);
    }
    return {
      summary:
        encoding.toUpperCase() +
        ' · BOM ' +
        (bom || '无') +
        (text.includes('\uFFFD') ? ' · 含替代字符，部分原文可能已丢失' : ''),
      rows: csv([
        ['检查', '结果'],
        ['前 64 字节', hex(raw.slice(0, 64))],
        ['CRLF', (text.match(/\r\n/g) ?? []).length],
        ['LF', (text.match(/(?<!\r)\n/g) ?? []).length],
        ['CR', (text.match(/\r(?!\n)/g) ?? []).length],
      ]),
      sourceText: text.slice(0, 20000),
      blob: new Blob([out]),
      ext: 'txt',
    };
  }
  if (id === 'cert-inspect') {
    await import('reflect-metadata');
    const { X509Certificate, SubjectAlternativeNameExtension } = await import('@peculiar/x509');
    const cert = new X509Certificate(raw[0] === 45 ? new TextDecoder().decode(raw) : bytes),
      sans = cert.getExtension(SubjectAlternativeNameExtension)?.names.items ?? [];
    const host = (o.host ?? '').toLowerCase().replace(/\.$/, ''),
      match = sans.some((s) => {
        const n = s.value.toLowerCase();
        return (
          ['dns', 'ip'].includes(s.type.toLowerCase()) &&
          (n === host ||
            (n.startsWith('*.') &&
              host.split('.').length === n.split('.').length &&
              host.endsWith(n.slice(1))))
        );
      });
    return {
      summary:
        Date.now() < +cert.notBefore ? '尚未生效' : Date.now() > +cert.notAfter ? '已过期' : '在有效期内',
      rows: csv([
        ['字段', '值'],
        ['主题', cert.subject],
        ['颁发者', cert.issuer],
        ['序列号', cert.serialNumber],
        ['生效', cert.notBefore.toISOString()],
        ['到期', cert.notAfter.toISOString()],
        ['SHA-256', hex(new Uint8Array(await cert.getThumbprint('SHA-256'))).replace(/ /g, ':')],
        ['SAN', sans.map((s) => s.type + ': ' + s.value).join('\n')],
        ['域名核对', host ? host + (match ? ' 匹配' : ' 不匹配') : '未指定'],
      ]),
    };
  }
  if (id === 'excel-inspect') {
    const entries = archiveEntries(bytes);
    if (entries.reduce((n, e) => n + e.size, 0) > 160_000_000) throw Error('工作簿展开后过大');
    const { default: ExcelJS } = await import('exceljs'),
      book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.getWorksheet(o.sheet) || book.worksheets[0];
    if (!sheet) throw Error('工作簿中没有工作表');
    const data: unknown[][] = [],
      rows: unknown[][] = [['单元格', '公式', '缓存结果']],
      value = (v: unknown): unknown =>
        v instanceof Date
          ? v.toISOString()
          : v && typeof v === 'object'
            ? 'richText' in v
              ? (v.richText as { text: string }[]).map((t) => t.text).join('')
              : 'text' in v
                ? v.text
                : 'error' in v
                  ? v.error
                  : JSON.stringify(v)
            : v;
    if (sheet.rowCount * Math.max(sheet.columnCount, 1) > 1_000_000)
      throw Error('工作表超过 1,000,000 个单元格');
    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i),
        cells: unknown[] = [];
      for (let j = 1; j <= sheet.columnCount; j++) {
        const cell = row.getCell(j);
        cells.push(value(cell.formula ? cell.result : cell.value));
        if (cell.formula) rows.push([cell.address, cell.formula, value(cell.result)]);
      }
      data.push(cells);
    }
    return {
      summary:
        book.worksheets.map((s) => s.name + ' (' + s.state + ')').join('、') +
        '\n合并区域：' +
        (sheet.model.merges.join(', ') || '无'),
      choices: book.worksheets.map((s) => s.name),
      rows: csv(rows),
      data: csv(data),
      ext: 'csv',
    };
  }
  if (id === 'parquet-view') {
    const { parquetMetadata, parquetSchema, parquetReadObjects } = await import('hyparquet'),
      { compressors } = await import('./parquet-codecs');
    const meta = parquetMetadata(bytes),
      fields = parquetSchema(meta).children.map((n) => n.element),
      names = fields.map((f) => f.name);
    const selected = o.columns?.trim() ? o.columns.split(',').map((k) => k.trim()) : names;
    if (!selected.length || selected.some((k) => !names.includes(k)))
      throw Error('可选列：' + names.join('、'));
    const count = Number(meta.num_rows),
      start = Number(o.offset || 0),
      limit = Number(o.limit || Math.max(1, Math.floor(1_000_000 / selected.length)));
    if (!Number.isInteger(start) || start < 0 || start > count || !Number.isInteger(limit) || limit < 1)
      throw Error('请检查起始行和读取行数');
    const end = Math.min(start + limit, count);
    if ((end - start) * selected.length > 1_000_000)
      throw Error('所选数据超过 1,000,000 个单元格，请减少行数或列数');
    const data =
      end > start
        ? await parquetReadObjects({
            file: bytes,
            columns: selected,
            compressors,
            rowStart: start,
            rowEnd: end,
          })
        : [];
    const format = (v: unknown) =>
      typeof v === 'object' && v !== null
        ? JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? String(x) : x))
        : String(v ?? '');
    return {
      columnNames: names,
      summary:
        count +
        ' 行 · ' +
        names.length +
        ' 列 · 当前导出 ' +
        data.length +
        ' 行 × ' +
        selected.length +
        ' 列，起始偏移 ' +
        start,
      rows: csv([
        ['字段', '物理类型', '选中列空值数'],
        ...fields.map((f) => [
          f.name,
          f.type ?? '结构',
          selected.includes(f.name) ? data.filter((r) => r[f.name] == null).length : '',
        ]),
      ]),
      data: csv([selected, ...data.map((r) => selected.map((k) => format(r[k])))]),
      ext: 'csv',
    };
  }
  throw Error('不支持的文件处理方式');
}
