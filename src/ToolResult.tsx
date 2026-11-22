import { useMemo, useState } from 'react';
import { MotionButton, MotionDetails } from './Motion';
import type { JsonChange } from './structured-diff';
import { Copy, Check, AlertCircle } from 'lucide-react';
import type { Options, ToolId } from './tools';
import ResultView from './ResultView';
import ResultPager from './ResultPager';
import SegmentedControl from './SegmentedControl';
import { ResultTable } from './analysis/AnalysisTable';
import { parseEnvSide } from './developer';
import { parseCsv } from './practical';
import { digestMatches } from './tool-experience';
import { jsonObjectFields } from './result-model';

type Props = { id: ToolId; text: string; source: string; options: Options; expected: string; onExpected: (value: string) => void; onCopy: (value: string) => void };
const display = (value: unknown): string => value === null ? '无' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
function Fields({ data, onCopy }: { data: Record<string, unknown>; onCopy: (value: string) => void }) {
  return <dl className="detail-fields">{Object.entries(data).map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{display(value)}</code><MotionButton variant="copy" className="icon-button" aria-label={`复制 ${label}`} onClick={() => onCopy(display(value))}><Copy size={13} /></MotionButton></dd></div>)}</dl>;
}
function TimeScrubber({ times, zone }: { times: string[]; zone: string }) {
  const [index, setIndex] = useState(0);
  if (!times.length) return null;
  const selected = Math.min(index, times.length - 1);
  return <label className="time-scrubber">触发点 {selected + 1} / {times.length}
    <input aria-label="选择触发时间" type="range" min={0} max={times.length - 1} value={selected} onChange={e => setIndex(Number(e.target.value))} />
    <output>{times[selected]} · {zone}</output></label>;
}
function EnvChanges({ text, source, target }: { text: string; source: string; target: string }) {
  const groups = useMemo(() => JSON.parse(text) as Record<string, string[]>, [text]);
  const values = useMemo(() => [parseEnvSide(source, '左侧'), parseEnvSide(target, '右侧')], [source, target]);
  const [group, setGroup] = useState(() => Object.keys(groups).find(name => groups[name].length) ?? Object.keys(groups)[0]);
  const [page, setPage] = useState(0);
  const keys = groups[group] ?? [];
  const pages = Math.max(1, Math.ceil(keys.length / 50));
  const current = Math.min(page, pages - 1);
  return <div className="env-changes">
    <SegmentedControl label="差异类型" value={group}
      options={Object.entries(groups).map(([name, items]) => ({ value: name, label: name + ' · ' + items.length }))}
      onChange={name => { setGroup(name); setPage(0); }} />
    {keys.slice(current * 50, current * 50 + 50).map(key => <MotionDetails key={key} className="workbench-disclosure env-change">
      <summary><code>{key}</code></summary>
      <dl>{values.map((side, i) => <div key={i}>
        <dt>{i === 0 ? '左侧' : '右侧'}</dt>
        <dd><code>{Object.hasOwn(side, key) ? JSON.stringify(side[key]) : '缺失'}</code></dd>
      </div>)}</dl>
    </MotionDetails>)}
    {!keys.length && <p className="preview-note" role="status">此组没有差异</p>}
    <ResultPager page={current} pages={pages} onPage={setPage} />
  </div>;
}
export default function ToolResult({ id, text, source, options, expected, onExpected, onCopy }: Props) {
  const fallback = <ResultView toolId={id} text={text} source={source} onCopy={onCopy} initialView={id === 'csv-json' ? 'table' : 'tree'} />;
  // Large results retain the bounded structured preview or raw editor.
  if (text.length > 300_000) return <p className="preview-note">结果较大，请使用源码视图或导出文件查看完整内容。</p>;
  if (id === 'env' && options.mode === 'compare') return <EnvChanges text={text} source={source} target={options.target ?? ''} />;
  if (id === 'timestamp' && options.mode === 'batch') return <ResultTable columnLimit={30} records={parseCsv(text, '\t')} />;
  if (id === 'markdown-table') return <ResultTable columnLimit={30} records={parseCsv(options.mode === 'delimited' ? text : source, options.delimiter === 'tab' ? '\t' : ',')} />;
  if (id === 'mock-data' && options.format === 'csv') { try { return <ResultTable columnLimit={30} records={parseCsv(text, ',')} />; } catch { return fallback; } }
  if (id === 'diff' && options.mode === 'json') {
    const report = JSON.parse(text) as JsonChange[] | { changes: JsonChange[]; ignored: number };
    const rows = Array.isArray(report) ? report : report.changes;
    const names = { added: '新增', removed: '删除', changed: '修改', moved: '移动' };
    return <div className="json-diff-result"><p className="preview-note">{rows.length ? rows.length + ' 项结构差异（预览前 500 项）' : '结构一致'}{!Array.isArray(report) && ' · 已忽略 ' + report.ignored + ' 项'}</p><div className="data-table"><table><thead><tr><th>类型</th><th>字段路径</th><th>原始值</th><th>修改后</th></tr></thead><tbody>{rows.slice(0, 500).map((row, index) => <tr key={index}><td>{names[row.kind]}</td><td><button className="text-button" onClick={() => onCopy(row.path)}>{row.path}</button>{row.from && <small>来自 {row.from}</small>}</td><td><pre>{row.before ?? '—'}</pre></td><td><pre>{row.after ?? '—'}</pre></td></tr>)}</tbody></table></div></div>;
  }
  if (id === 'hash' || id === 'hmac') {
    const equal = digestMatches(text, expected, id === 'hmac' ? options.format : 'hex');
    return <div className="digest-result"><span className="result-kicker">{options.algorithm} · {id === 'hmac' ? options.format?.toUpperCase() : 'HEX'}</span><code className="digest-value">{text}</code><MotionButton variant="copy" className="secondary-button" onClick={() => onCopy(text)}><Copy size={14} />复制{ id === 'hash' ? '摘要' : '签名'}</MotionButton><label className="digest-compare">核对已有值<input aria-label="待核对摘要或签名" value={expected} onChange={event => onExpected(event.target.value)} placeholder="粘贴已有值进行核对" spellCheck={false} /></label>{equal !== null && <p role="status" className={equal ? 'success-text' : 'mismatch-text'}>{equal ? <Check size={16} /> : <AlertCircle size={16} />}{equal ? '完全一致' : '值不一致'}</p>}</div>;
  }
  if (id === 'timestamp') return <Fields data={Object.fromEntries(text.split('\n').map(line => { const match = line.match(/^(\S+)\s+(.+)$/); return match ? [match[1], match[2]] : [line, '']; }))} onCopy={onCopy} />;
  if (id === 'radix') return <div className="number-result"><span className="result-kicker">BASE {options.from} → BASE {options.to}</span><code>{text}</code><MotionButton variant="copy" className="secondary-button" onClick={() => onCopy(text)}><Copy size={14} />复制数值</MotionButton><p className="preview-note">整数换算使用 BigInt，保留大整数精度。</p></div>;
  if (id === 'css-unit') { const inputs = source.split(/\r?\n/).filter(line => line.trim()); return <ResultTable columnLimit={30} records={[[`原始值 · ${options.from}`, `换算值 · ${options.to}`], ...text.split('\n').map((line, index) => [inputs[index] || '', line])]} />; }
  if (id === 'json-csv') { try { return <ResultTable columnLimit={30} records={parseCsv(text, options.delimiter === 'tab' ? '\t' : ',')} />; } catch { return <p className="preview-note">表格无法预览，请查看源码。</p>; } }
  if (['hash', 'hmac', 'timestamp', 'radix', 'css-unit', 'json-csv'].includes(id)) return fallback;
  if (!['http-status', 'ipv4', 'chmod', 'cron', 'text-stats', 'url-inspect', 'jwt', 'ulid'].includes(id) || id === 'ulid' && options.mode !== 'parse') return fallback;
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch { return fallback; }
  if (id === 'http-status') return <div className="http-results">{(data as unknown as { code: number; name: string; description: string }[]).map(item => <article key={item.code} className={`http-status-family family-${Math.floor(item.code / 100)}`}><strong>{item.code}</strong><div><h3>{item.name}</h3><p>{item.description}</p></div><MotionButton variant="copy" className="icon-button" aria-label={`复制状态码 ${item.code}`} onClick={() => onCopy(String(item.code))}><Copy size={14} /></MotionButton></article>)}</div>;
  if (id === 'cron') return <div className="schedule-result"><Fields data={{ '表达式': data.expression, '时区': data.timezone, '严格晚于': data.after }} onCopy={onCopy} /><TimeScrubber times={data.matches as string[]} zone={String(data.timezone)} /><ol className="schedule-timeline">{(data.matches as string[]).map((time, index) => <li key={time}><span>{String(index + 1).padStart(2, '0')}</span><time dateTime={time}>{time.replace('T', ' ').replace('.000Z', ' UTC')}</time><MotionButton variant="copy" className="icon-button" aria-label={`复制触发时间 ${index + 1}`} onClick={() => onCopy(time)}><Copy size={13} /></MotionButton></li>)}</ol><p className="preview-note">{data.complete ? '已找到全部预览时间。' : '搜索窗口内未找到足够的触发时间。'}{display(data.note)}</p></div>;
  if (id === 'text-stats') {
    const labels: Record<string, string> = { utf8Bytes: 'UTF-8 字节', utf16Units: 'UTF-16 单元', unicodeCodePoints: 'Unicode 码点', graphemeClusters: '可见字符簇', words: '单词', lines: '行数', nonEmptyLines: '非空行', whitespaceCodePoints: '空白码点' };
    return <div className="stats-result"><div className="metric-grid">{Object.entries(labels).map(([key, label]) => <div key={key}><span>{label}</span><strong>{Number(data[key]).toLocaleString()}</strong></div>)}</div><Fields data={{ '换行统计': data.lineEndings }} onCopy={onCopy} /><p className="preview-note">{display(data.note)}</p></div>;
  }
  if (id === 'ipv4') return <div className="subnet-result"><div className="subnet-summary"><span className="result-kicker">NETWORK / PREFIX</span><strong>{display(data.cidr)}</strong><div className="subnet-bits" aria-label={`网络位 ${data.prefix}，主机位 ${32 - Number(data.prefix)}`}>{Array.from({ length: 32 }, (_, index) => <span className={index < Number(data.prefix) ? 'network-bit' : ''} key={index} />)}</div><small>网络位 {display(data.prefix)} · 主机位 {32 - Number(data.prefix)}</small></div><Fields data={{ '子网掩码': data.netmask, '反掩码': data.wildcard, '网络地址': data.network, '广播地址': data.broadcast, '首个主机': data.firstHost, '末个主机': data.lastHost, '地址总数': data.totalAddresses, '可用主机': data.usableHosts }} onCopy={onCopy} /><p className="preview-note">{display(data.note)}</p></div>;
  if (id === 'chmod') return <div className="permission-result"><div className="permission-value"><strong>{display(data.octal)}</strong><code>{display(data.symbolic)}</code></div><Fields data={{ '所有者': (data.groups as { symbolic: string }[])[0].symbolic, '所属组': (data.groups as { symbolic: string }[])[1].symbolic, '其他人': (data.groups as { symbolic: string }[])[2].symbolic, '特殊权限': data.special, '命令参考（不执行）': data.command }} onCopy={onCopy} /><p className="preview-note">{display(data.note)}</p></div>;
  if (id === 'url-inspect') return <div className="url-result"><Fields data={{ '协议': data.protocol, '主机': data.hostname, '端口': data.port || '默认', '路径': data.pathname, '片段': data.hash, 'Origin': data.origin, '用户名': data.username, '密码': data.password }} onCopy={onCopy} /><h3 className="result-section-title">查询参数 · {(data.query as unknown[]).length} 项</h3><ResultTable columnLimit={30} records={[[ '参数名', '值' ], ...(data.query as { name: string; value: string }[]).map(item => [item.name, item.value])]} /><p className="preview-note">重复参数按原始顺序保留。</p></div>;
  if (id === 'jwt') {
    const fields = jsonObjectFields(text);
    return <div className="jwt-result"><p className="preview-note">{display(data.notice)}</p>{[['header', 'Header · 算法与类型'], ['payload', 'Payload · 载荷'], ['dates', '时间声明 · UTC'], ['signature', 'Signature · 未验证']].map(([key, title]) => <section key={key}><h3>{title}</h3>{key === 'signature' ? <code>{display(data[key])}</code> : <ResultView toolId="json" text={fields.get(key)?.raw ?? '{}'} source="" onCopy={onCopy} />}</section>)}</div>;
  }
  if (id === 'ulid') return <div className="ulid-results">{(data as unknown as Record<string, unknown>[]).slice(0, 100).map((item, index) => <section key={index}><h3>#{index + 1} · ULID</h3><Fields data={{ '标识': item.ulid, 'UTC 时间': item.utc, '毫秒时间戳': item.timestamp, '随机段': item.randomness }} onCopy={onCopy} /></section>)}<p className="preview-note">预览前 100 项；源码和导出保留全部结果。</p></div>;
  return fallback;
}
