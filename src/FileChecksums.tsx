import { useEffect, useRef, useState } from 'react';
import { fileDigest } from './file-digest';
import { readText, saveText } from './files';

export function parseManifest(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const row = /^([a-f0-9]{64}) [ *](.+)$/i.exec(line);
    if (!row || values.has(row[2])) throw new Error('清单包含无效行或重复文件名。');
    values.set(row[2], row[1].toLowerCase());
  }
  if (!values.size) throw new Error('清单为空。');
  return values;
}

export default function FileChecksums() {
  const [rows, setRows] = useState(new Map<string, string>());
  const [manifest, setManifest] = useState(new Map<string, string>());
  const [expected, setExpected] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function calculate(files: File[]) {
    if (!files.length) return;
    const run = ++generation.current;
    setBusy(true);
    setRows(new Map());
    try {
      const results = new Map<string, string>();
      for (const file of files) {
        if (results.has(file.name) || /[\r\n\\]/.test(file.name))
          throw new Error('请选择名称唯一且不含换行或反斜线的文件。');
        const digest = await fileDigest(
          file,
          (read) => {
            if (run === generation.current)
              setStatus(file.name + ' · ' + Math.floor((100 * read) / file.size) + '%');
          },
          () => run !== generation.current,
        );
        results.set(file.name, digest);
      }
      if (run === generation.current) {
        setRows(results);
        setStatus('已计算 ' + results.size + ' 个文件');
      }
    } catch (error) {
      if (run === generation.current) setStatus(String(error));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  return (
    <details className="devkit-panel">
      <summary>文件 SHA-256 与批量校验</summary>
      <div
        className="devkit-fields"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void calculate(Array.from(e.dataTransfer.files));
        }}
      >
        <label>
          选择或拖入文件
          <input
            type="file"
            multiple
            onChange={(e) => {
              void calculate(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
        </label>
        <label>
          导入 SHA256SUMS
          <input
            type="file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                setManifest(parseManifest((await readText(file)).text));
                setStatus('已导入校验清单');
              } catch (error) {
                setManifest(new Map());
                setStatus(String(error));
              }
            }}
          />
        </label>
        {rows.size === 1 && (
          <label>
            预期 SHA-256
            <input value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
        )}
        {!!rows.size && (
          <button
            onClick={() =>
              void saveText([...rows].map(([name, hex]) => hex + '  ' + name + '\n').join(''), 'SHA256SUMS')
                .then(setStatus)
                .catch((e) => setStatus(String(e)))
            }
          >
            导出 SHA256SUMS
          </button>
        )}
        {busy && (
          <button
            onClick={() => {
              generation.current++;
              setBusy(false);
              setStatus('已取消');
            }}
          >
            取消计算
          </button>
        )}
      </div>
      <p role="status">{status}</p>
      {[...rows].map(([name, hex]) => (
        <p key={name}>
          <strong>{name}</strong> <code>{hex}</code>{' '}
          {manifest.has(name)
            ? manifest.get(name) === hex
              ? '清单一致'
              : '清单不一致'
            : manifest.size
              ? '清单未列出'
              : ''}{' '}
          {rows.size === 1 &&
            expected.trim() &&
            (hex === expected.trim().toLowerCase() ? '预期值一致' : '预期值不一致')}
        </p>
      ))}
      {!!rows.size &&
        [...manifest.keys()]
          .filter((name) => !rows.has(name))
          .map((name) => <p key={name}>缺少文件 · {name}</p>)}
    </details>
  );
}
