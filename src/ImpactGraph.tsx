import { useState } from 'react';
import type { NginxReview } from './nginx-api';

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) || path;
}

export default function ImpactGraph({ review, paths }: { review: NginxReview; paths: string[] }) {
  const files = paths.length ? paths : [...new Set(review.impacts.flatMap((instance) => instance.files))];
  const [selection, setSelection] = useState('');
  const path = files.includes(selection) ? selection : files[0];
  if (!path) return null;
  const instances = review.impacts.filter((instance) => instance.files.includes(path));
  const references = [
    ...new Set(
      instances.flatMap((item) =>
        item.references.filter((ref) => ref.to === path).map((ref) => ref.from + ':' + ref.line),
      ),
    ),
  ];
  return (
    <section className="impact-graph" aria-label="配置影响图">
      <label>
        配置文件
        <select value={path} onChange={(event) => setSelection(event.target.value)}>
          {files.map((file) => (
            <option key={file}>{file}</option>
          ))}
        </select>
      </label>
      <div className="impact-flow">
        <div>
          <strong>引用来源</strong>
          {references.length ? (
            references.map((ref) => (
              <code key={ref} title={ref} aria-label={ref}>
                {fileName(ref)}
              </code>
            ))
          ) : (
            <small>未发现引用</small>
          )}
        </div>
        <span aria-hidden="true">→</span>
        <code title={path} aria-label={path}>
          {fileName(path)}
        </code>
        <span aria-hidden="true">→</span>
        <div>
          <strong>受影响实例</strong>
          {instances.length ? (
            instances.map((instance) => (
              <button
                key={instance.id}
                aria-controls={'impact-' + instance.id}
                onClick={() => document.getElementById('impact-' + instance.id)?.focus()}
              >
                {instance.name}
              </button>
            ))
          ) : (
            <small>未发现实例</small>
          )}
        </div>
      </div>
    </section>
  );
}
