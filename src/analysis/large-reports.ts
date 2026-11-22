import { byAnalysis } from './catalog';
import type { Opt } from './tabular';
import type { FileReport } from './file-analysis';

export const largeReports = new Set(['har-waterfall', 'source-map', 'cpu-profile', 'bundle-size']);
function preview(text: string, limit: number) {
  let quoted = false,
    lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    }
    if (!quoted && text[i] === '\n' && ++lines === limit) return text.slice(0, i).trimEnd();
  }
  return text;
}
export async function largeReport(
  id: string,
  file: File,
  right: File | undefined,
  options: Opt,
): Promise<FileReport> {
  const { runAnalysis } = await import('./run');
  const opts = { ...byAnalysis.get(id)!.options, ...options };
  if (right) opts.target = await right.text();
  const data = await runAnalysis(id, await file.text(), opts);
  if (data.length > 40_000_000) throw Error('报告超过 4000 万字符，请减少采样范围或选择汇总视图');
  const rows = preview(data, 501);
  return {
    summary: file.name + ' · ' + (rows === data ? '全部记录' : '预览前 500 条，下载包含完整报告'),
    rows,
    data,
    ext: 'csv',
  };
}
