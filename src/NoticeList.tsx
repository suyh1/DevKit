import './notice-list.css';

export default function NoticeList({ label, notices }: { label: string; notices: string[] }) {
  if (!notices.length) return null;
  return <details className="notice-list">
    <summary>{label}（{notices.length}）</summary>
    <ul aria-label={label} tabIndex={0}>
      {notices.map((notice, index) => <li key={index}>{notice}</li>)}
    </ul>
  </details>;
}
