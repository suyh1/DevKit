import { useMemo, useRef, useState } from 'react';
import { Copy, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { diffRows, jsonTree, nodePath } from './result-model';
import type { JsonNode } from './result-model';
import type { ToolId } from './tools';

function TreeNode({ node, label, path, depth, query, onCopy }: { node: JsonNode; label: string; path: string; depth: number; query: string; onCopy: (text: string) => void }) {
  const visible = !query || label.toLowerCase().includes(query) || node.raw.toLowerCase().includes(query);
  if (!visible) return null;
  const actions = <span className="node-actions"><button title="复制字段路径" aria-label={`复制路径 ${path}`} onClick={event => { event.preventDefault(); onCopy(path); }}>$</button><button title="复制原始值" aria-label={`复制值 ${path}`} onClick={event => { event.preventDefault(); onCopy(node.raw); }}><Copy size={12} /></button></span>;
  if (node.kind === 'value') return <div className="tree-leaf"><span className="tree-key">{label}</span><code className={`json-value ${node.raw.startsWith('"') ? 'string' : 'literal'}`}>{node.raw}</code>{actions}</div>;
  return <details className="tree-branch" open={query || depth === 0 ? true : undefined} key={`${path}-${query ? 'search' : 'browse'}`}><summary><span className="tree-key">{label}</span><small>{node.kind === 'array' ? '[' : '{'} {node.children.length} 项 {node.kind === 'array' ? ']' : '}'}</small>{actions}</summary><div className="tree-children">{depth < 40 ? node.children.map(({ key, node: child }, index) => <TreeNode key={`${key}-${index}`} node={child} label={key} path={nodePath(path, key, node.kind === 'array')} depth={depth + 1} query={query} onCopy={onCopy} />) : <p className="preview-note">层级较深，请复制此节点或查看源码。</p>}</div></details>;
}

function DiffView({ text }: { text: string }) {
  const rows = useMemo(() => diffRows(text), [text]);
  const [index, setIndex] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const changes = rows.filter(row => row.kind === 'hunk').length;
  function jump(direction: number) {
    const next = (index + direction + changes) % changes;
    setIndex(next);
    container.current?.querySelectorAll('.diff-hunk')[next]?.scrollIntoView({ block: 'nearest' });
  }
  if (rows.length > 5000) return <p className="preview-note">差异较大，请查看源码或导出补丁。</p>;
  return <div className="diff-preview"><div className="preview-toolbar"><span>{changes ? `${changes} 处差异块 · 只显示差异附近内容` : '按当前规则未发现差异'}</span><button disabled={!changes} onClick={() => jump(-1)} aria-label="上一处差异"><ChevronUp size={14} /></button><button disabled={!changes} onClick={() => jump(1)} aria-label="下一处差异"><ChevronDown size={14} /></button></div><div className="diff-scroll" ref={container}><table className="diff-table"><thead><tr><th colSpan={2}>原始文本</th><th colSpan={2}>修改后文本</th></tr></thead><tbody>{rows.map((row, position) => row.kind === 'hunk' ? <tr className="diff-hunk" key={position}><td colSpan={4}>{row.left}</td></tr> : <tr key={position} className={row.kind}><td>{row.leftLine}</td><td>{row.left}</td><td>{row.rightLine}</td><td>{row.right}</td></tr>)}</tbody></table></div></div>;
}

function MatchView({ text, source }: { text: string; source: string }) {
  const data = JSON.parse(text) as { count: number; limitReached: boolean; matches: { match: string; index: number; groups: unknown[]; namedGroups?: Record<string, string> }[] };
  let position = 0;
  const fragments: React.ReactNode[] = [];
  for (const [index, match] of data.matches.slice(0, 200).entries()) {
    fragments.push(source.slice(position, match.index));
    fragments.push(<mark key={index} title={`位置 ${match.index}`}>{match.match || '∅'}</mark>);
    position = match.index + match.match.length;
  }
  fragments.push(source.slice(position));
  return <div className="match-preview"><p className="preview-note">{data.count} 个匹配{data.limitReached ? '（达到结果上限）' : ''} · 预览前 200 项</p><pre className="match-source">{fragments}</pre>{data.matches.slice(0, 200).map((match, index) => <details className="match-item" key={index}><summary><span>#{index + 1} · 位置 {match.index}</span><code>{match.match || '空匹配'}</code></summary><pre>{JSON.stringify({ groups: match.groups, namedGroups: match.namedGroups }, null, 2)}</pre></details>)}</div>;
}

function TableView({ node }: { node: JsonNode }) {
  const rows = node.children.slice(0, 100).map(child => child.node);
  const keys = [...new Set(rows.flatMap(row => row.children.map(child => child.key)))].slice(0, 30);
  if (node.kind !== 'array' || rows.some(row => row.kind === 'value')) return <p className="preview-note">此结果不适合表格展示，请使用结构或源码视图。</p>;
  return <div className="table-preview"><p className="preview-note">共 {node.children.length} 行 · 预览前 100 行、30 列 · 数字保持原始精度</p><table><thead><tr><th>#</th>{keys.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{index + 1}</td>{keys.map(key => <td key={key}>{row.children.find(child => child.key === key)?.node.raw ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}

export default function ResultView({ toolId, text, source, onCopy }: { toolId: ToolId; text: string; source: string; onCopy: (text: string) => void }) {
  const [query, setQuery] = useState(''), [view, setView] = useState('tree');
  const parsed = useMemo(() => {
    if (['diff', 'password', 'uuid', 'regex'].includes(toolId)) return {};
    try { return { node: jsonTree(text) }; } catch (error) { return { error: error instanceof Error ? error.message : '无法生成预览' }; }
  }, [text, toolId]);
  if (toolId === 'diff') return <DiffView text={text} />;
  if (toolId === 'password' || toolId === 'uuid' || toolId === 'ulid' && !text.startsWith('[')) return <div className="generated-list">{text.split('\n').map((line, index) => <div key={index}><span>{String(index + 1).padStart(2, '0')}</span><code>{line}</code><button className="icon-button" aria-label={`复制第 ${index + 1} 条`} onClick={() => onCopy(line)}><Copy size={14} /></button></div>)}</div>;
  if (toolId === 'regex') {
    if (source.length > 100_000) return <p className="preview-note">匹配高亮支持 100,000 字符以内的输入，请使用源码视图。</p>;
    return <MatchView text={text} source={source} />;
  }
  if (!parsed.node) return <p className="preview-note">{parsed.error}</p>;
  return <div className="structured-preview"><div className="preview-toolbar"><label><Search size={14} /><input aria-label="搜索结果节点" placeholder="搜索字段或值…" value={query} onChange={event => setQuery(event.target.value)} /></label>{parsed.node.kind === 'array' && <button onClick={() => setView(value => value === 'tree' ? 'table' : 'tree')}>{view === 'tree' ? '表格视图' : '结构视图'}</button>}<small>原始精度 · $ 复制路径</small></div>{view === 'table' ? <TableView node={parsed.node} /> : <div className="json-tree"><TreeNode node={parsed.node} label="$" path="$" depth={0} query={query.trim().toLowerCase()} onCopy={onCopy} /></div>}</div>;
}
