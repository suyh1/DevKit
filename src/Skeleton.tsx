export default function Skeleton({ kind = 'editor', label }: { kind?: 'editor' | 'projects' | 'list'; label?: string }) {
  return <div className={`loading-skeleton skeleton-${kind}`} role="status" aria-busy="true">
    <span className="sr-only">{label ?? (kind === 'editor' ? '正在准备编辑器…' : '正在加载项目中心…')}</span>
    {kind === 'projects' && <div className="skeleton-top" aria-hidden="true"><i /><i /><i /></div>}
    <div className="skeleton-lines" aria-hidden="true">{Array.from({ length: kind === 'list' ? 3 : kind === 'editor' ? 7 : 5 }, (_, index) => <span key={index} />)}</div>
  </div>;
}
