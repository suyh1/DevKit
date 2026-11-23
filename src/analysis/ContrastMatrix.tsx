import FloatingDetails from '../FloatingDetails';
import { contrastReport, parseColor } from '../colors';
export default function ContrastMatrix({ colors }: { colors: string[] }) {
  return (
    <FloatingDetails className="analysis-file">
      <summary>收藏色对比矩阵</summary>
      {colors.length < 2 ? (
        <p>收藏两种以上颜色后，可比较文字与背景的 WCAG 对比度。</p>
      ) : (
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>文字 / 背景</th>
                {colors.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colors.map((a) => (
                <tr key={a}>
                  <th scope="row">{a}</th>
                  {colors.map((b) => {
                    const r = contrastReport(parseColor(a), parseColor(b));
                    return (
                      <td key={b} title={a + ' / ' + b} style={{ borderInlineStart: '5px solid ' + a }}>
                        {r.ratio.toFixed(2)} ·{' '}
                        {r.aaa ? 'AAA' : r.aa ? 'AA' : r.aaLarge ? '大字 AA' : '未通过'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FloatingDetails>
  );
}
