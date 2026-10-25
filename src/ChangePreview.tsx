import { useMemo } from 'react';
import { createTwoFilesPatch } from 'diff';
import { diffRows } from './result-model';

export default function ChangePreview({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => {
    if (before.length > 500_000 || after.length > 500_000) return null;
    const patch = createTwoFilesPatch('原文件', '修改后', before, after, '', '', { context: 3, timeout: 300, maxEditLength: 10000 });
    return patch === undefined ? null : diffRows(patch);
  }, [before, after]);
  if (before === after) return <p className="preview-note">内容一致。</p>;
  if (!rows) return <p className="preview-note">差异较大，超出快速预览范围，请分别导出或使用全文查看。</p>;
  return <div className="change-preview" aria-label="文件差异"><table><thead><tr><th>原行</th><th>原文件</th><th>新行</th><th>修改后</th></tr></thead><tbody>{rows.slice(0, 500).map((row, index) => <tr key={index} className={`change-${row.kind}`}><td>{row.leftLine}</td><td><pre>{row.left}</pre></td><td>{row.rightLine}</td><td><pre>{row.right}</pre></td></tr>)}</tbody></table>{rows.length > 500 && <p>预览前 500 行，完整内容可导出。</p>}</div>;
}
