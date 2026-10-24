export default function Skeleton({ kind = 'editor' }: { kind?: 'editor' | 'projects' }) {
  return <div className={`loading-skeleton skeleton-${kind}`} role="status" aria-busy="true">
    <span className="sr-only">{kind === 'editor' ? '正在准备编辑器…' : '正在加载项目中心…'}</span>
    <div className="skeleton-top" aria-hidden="true"><i /><i /><i /></div>
    <div className="skeleton-lines" aria-hidden="true">{Array.from({ length: kind === 'editor' ? 7 : 5 }, (_, index) => <span key={index} />)}</div>
  </div>;
}
