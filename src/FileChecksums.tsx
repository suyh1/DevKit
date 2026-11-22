import { useEffect, useRef, useState } from 'react';
import { FileText, Files } from 'lucide-react';
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
  const [manifestName, setManifestName] = useState('');
  const [fileCount, setFileCount] = useState(0);
  const [expected, setExpected] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const manifestGeneration = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      manifestGeneration.current++;
    },
    [],
  );
  async function calculate(files: File[]) {
    if (!files.length) return;
    const run = ++generation.current;
    setFileCount(files.length);
    setBusy(true);
    setRows(new Map());
    try {
      const results = new Map<string, string>();
      for (const file of files) {
        const path = file.webkitRelativePath?.split('/').slice(1).join('/') || file.name;
        if (results.has(path) || /[\r\n\\]/.test(file.name))
          throw new Error('请选择名称唯一且不含换行或反斜线的文件。');
        const digest = await fileDigest(
          file,
          (read) => {
            if (run === generation.current)
              setStatus(file.name + ' · ' + Math.floor((100 * read) / file.size) + '%');
          },
          () => run !== generation.current,
        );
        results.set(path, digest);
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
  async function importManifest(file?: File) {
    if (!file) return;
    const run = ++manifestGeneration.current;
    try {
      const entries = parseManifest((await readText(file)).text);
      if (run !== manifestGeneration.current) return;
      setManifest(entries);
      setManifestName(file.name);
      setStatus('已导入校验清单');
    } catch (error) {
      if (run !== manifestGeneration.current) return;
      setManifest(new Map());
      setManifestName('');
      setStatus(String(error));
    }
  }
  return (
    <details className="devkit-panel checksum-panel">
      <summary>文件 SHA-256 与批量校验</summary>
      <div
        className="checksum-fields"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void calculate(Array.from(e.dataTransfer.files));
        }}
      >
        <label>
          <span>待校验文件</span>
          <span className="checksum-picker">
            <Files size={15} aria-hidden="true" />
            选择或拖入文件
          </span>
          <input
            className="sr-only"
            aria-label="选择或拖入文件"
            type="file"
            multiple
            onChange={(e) => {
              void calculate(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <small>{fileCount ? `已选择 ${fileCount} 个文件` : '可一次选择多个文件'}</small>
        </label>
        <label
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void importManifest(e.dataTransfer.files[0]);
          }}
        >
          <span>对照清单</span>
          <span className="checksum-picker">
            <FileText size={15} aria-hidden="true" />
            导入 SHA256SUMS
          </span>
          <input
            className="sr-only"
            aria-label="导入 SHA256SUMS"
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void importManifest(file);
            }}
          />
          <small>{manifestName ? `${manifestName} · ${manifest.size} 项` : '可选，用于批量比对'}</small>
        </label>
        {rows.size === 1 && (
          <label>
            <span>预期 SHA-256</span>
            <input
              placeholder="输入比对摘要"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="checksum-actions">
        <label>
          计算目录
          <input
            type="file"
            multiple
            ref={(node) => node?.setAttribute('webkitdirectory', '')}
            onChange={(e) => void calculate(Array.from(e.target.files ?? []))}
          />
        </label>
        {rows.size > 0 && (
          <button
            disabled={busy}
            onClick={() => {
              setManifest(new Map(rows));
              setManifestName('基准目录');
              setStatus('基准已保存，请选择另一目录');
            }}
          >
            将当前目录设为对照基准
          </button>
        )}
        {!!rows.size && (
          <button
            className="secondary-button"
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
            className="secondary-button"
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
