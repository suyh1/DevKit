import './path-summary.css';

/** Keep the file and its nearest parent, adding ancestors for otherwise identical labels. */
export function pathSuffix(path: string, others: string[] = []) {
  const parts = (value: string) => value.split(/[\\/]+/).filter(Boolean);
  const segments = parts(path);
  const peers = others.filter(value => value !== path).map(parts);
  const separator = path.includes('\\') ? '\\' : '/';
  let count = Math.min(2, segments.length);
  while (count < segments.length && peers.some(peer => peer.slice(-count).join('/') === segments.slice(-count).join('/'))) count++;
  return count === segments.length ? path : '…' + separator + segments.slice(-count).join(separator);
}

export default function PathSummary({ path, label, others }: { path: string; label: string; others?: string[] }) {
  return <details className="path-summary">
    <summary title={path}><span>{label} · {pathSuffix(path, others)}</span></summary>
    <code className="disclosure-scroll">{path}</code>
  </details>;
}
