export function timestampDate(input: string, unit?: string) {
  const text = input.trim();
  let date: Date;
  if (/^-?\d+$/.test(text)) {
    const value = Number(text);
    if (!Number.isSafeInteger(value)) throw new Error('时间戳超出安全整数范围。');
    date = new Date(value * (unit === 'ms' ? 1 : 1000));
  } else {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(text)) throw new Error('请输入整数时间戳，或带时区的 ISO 日期，例如 2025-01-01T08:00:00+08:00。');
    const [year, month, day] = text.slice(0, 10).split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(text.slice(11, 13)) > 23) throw new Error('日期无效，请检查月份、天数和小时。');
    date = new Date(text);
  }
  if (!Number.isFinite(date.getTime())) throw new Error('日期无效或超出支持范围。');
  return date;
}

export function timeRows(input: string, unit: string, zone: string) {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('sv-SE', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23', timeZoneName: 'longOffset' });
  } catch { throw new Error('无效的 IANA 时区，请选择或输入如 Asia/Shanghai 的名称。'); }
  function field(value: string) { return /[\t"\n\r]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value; }
  const lines = input.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const rows = lines.map(line => {
    try { return [line, format.format(timestampDate(line, unit)), '']; }
    catch (error) { return [line, '', error instanceof Error ? error.message : '时间无效']; }
  });
  return [['原值', format.resolvedOptions().timeZone, '错误'], ...rows].map(row => row.map(field).join('\t')).join('\n');
}
