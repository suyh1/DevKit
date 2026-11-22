import { useEffect, useRef, useState } from 'react';
import { saveText, readText, downloadBlob } from '../files';
import { copyText } from '../motion-primitives';
import { clampValues, type MergeBlock } from './upgrades';
import type { Opt } from './tabular';
const specs: Record<
  string,
  { title: string; sample: string; options: Opt; labels: Record<string, string | string[]>; ext: string }
> = {
  diff: {
    title: '三方合并',
    sample: '甲\n本地修改\n尾',
    options: { base: '甲\n原文\n尾', target: '甲\n对方修改\n尾' },
    labels: { base: '共同祖先', target: '对方版本' },
    ext: 'txt',
  },
  json: {
    title: '生成 JSON Patch 并在另一份文档预演',
    sample: '{"id":1,"state":"open"}',
    options: { patchMode: 'generate', target: '{"id":1,"state":"closed"}', third: '{"id":2,"state":"open"}' },
    labels: { patchMode: ['generate', 'apply'], target: '目标 JSON', third: '应用补丁的文档' },
    ext: 'json',
  },
  yaml: {
    title: 'YAML ↔ TOML',
    sample: 'app:\n  name: DevKit\n  ports: [8080, 8081]',
    options: { direction: 'yaml-toml' },
    labels: { direction: ['yaml-toml', 'toml-yaml'] },
    ext: 'txt',
  },
  sql: {
    title: '从 CSV / JSON 生成批量 INSERT',
    sample: '[{"id":"001","note":null},{"id":"002","note":""}]',
    options: { table: 'orders', columns: '', nullMarker: '\\N', dialect: 'postgresql', batch: '100' },
    labels: {
      table: '目标表',
      columns: '选取字段（留空使用全部）',
      nullMarker: 'CSV 空值标记（区分空字符串）',
      dialect: ['postgresql', 'mysql', 'sqlite'],
      batch: '每批行数',
    },
    ext: 'sql',
  },
  'http-code': {
    title: '从 POSIX cURL 导入',
    sample:
      "curl -X POST 'https://example.org/orders' -H 'Content-Type: application/json' --data-raw '{\"id\":1}'",
    options: { style: 'fetch' },
    labels: { style: ['fetch', 'axios'] },
    ext: 'txt',
  },
  timestamp: {
    title: '比较两个时刻或相邻记录',
    sample: '2026-01-01T00:00:00Z\n2026-01-02T03:00:00Z',
    options: { unit: 'ms' },
    labels: { unit: ['ms', 's'] },
    ext: 'csv',
  },
  cron: {
    title: '按 IANA 时区预览',
    sample: '30 1 * * *',
    options: { zone: 'America/New_York', start: '2026-10-31T00:00:00Z', count: '5' },
    labels: { zone: '目标时区', start: '起始 ISO 时刻', count: '次数' },
    ext: 'csv',
  },
  uuid: { title: '生成或解析 UUID v7', sample: '5', options: {}, labels: {}, ext: 'txt' },
  'css-unit': {
    title: '响应字号 clamp()',
    sample: '',
    options: { fromWidth: '320', toWidth: '1280', fromSize: '14', toSize: '22' },
    labels: {
      fromWidth: '最小视口 px',
      toWidth: '最大视口 px',
      fromSize: '起始字号 px',
      toSize: '结束字号 px',
    },
    ext: 'css',
  },
  'geo-coordinates': {
    title: '两点测地线距离和初始方位',
    sample: '116.3913,39.9075',
    options: { target: '121.4737,31.2304' },
    labels: { target: '终点（经度,纬度）' },
    ext: 'csv',
  },
};
export function Base64Files() {
  const [value, setValue] = useState(''),
    [name, setName] = useState('decoded.bin'),
    [error, setError] = useState(''),
    [dataUrl, asUrl] = useState(true);
  const seq = useRef(0);
  async function encode(file?: File) {
    const run = ++seq.current;
    if (!file) return;
    try {
      if (file.size > 16_000_000) throw Error('文件上限 16 MB');
      const r = new FileReader();
      const data = await new Promise<string>((ok, no) => {
        r.onload = () => ok(String(r.result));
        r.onerror = () => no(Error('文件读取失败'));
        r.readAsDataURL(file);
      });
      if (seq.current !== run) return;
      setValue(dataUrl ? data : data.slice(data.indexOf(',') + 1));
      setName(file.name);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function restore() {
    try {
      const m = /^data:([^,]*);base64,/i.exec(value.trim()),
        body = (m ? value.trim().slice(m[0].length) : value).replace(/\s/g, '');
      const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
      downloadBlob(new Blob([bytes], { type: m?.[1] || 'application/octet-stream' }), name || 'decoded.bin');
      setError('');
    } catch (e) {
      setError('无法恢复：' + (e as Error).message);
    }
  }
  return (
    <details className="analysis-file" data-upgrade="base64">
      <summary>文件与 Base64 / Data URL 互转</summary>
      <label>
        <input type="checkbox" checked={dataUrl} onChange={(e) => asUrl(e.target.checked)} />
        编码时附带 Data URL
      </label>
      <input aria-label="编码文件" type="file" onChange={(e) => void encode(e.target.files?.[0])} />
      <textarea
        aria-label="文件 Base64"
        rows={5}
        value={value}
        onChange={(e) => {
          seq.current++;
          setValue(e.target.value);
        }}
      />
      <label>
        恢复文件名
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button onClick={() => void copyText(value).catch(() => setError('复制失败'))}>复制编码</button>
      <button onClick={restore}>还原并下载</button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export default function UpgradePanel({ id, current }: { id: string; current?: string }) {
  const spec = specs[id];
  const [source, setSource] = useState(''),
    [o, options] = useState<Opt>({}),
    [result, setResult] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [chosen, choose] = useState<Record<number, 'a' | 'b' | 'o'>>({}),
    [width, resize] = useState(768);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  if (!spec) return null;
  const opts = { ...spec.options, ...o };
  function clear() {
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    setResult('');
    setError('');
    choose({});
  }
  function run() {
    clear();
    setBusy(true);
    const w = new Worker(new URL('./upgrade.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const stop = () => {
      w.terminate();
      setBusy(false);
    };
    const timer = setTimeout(() => {
      if (worker.current === w) {
        stop();
        setError('处理超时');
      }
    }, 12000);
    w.onmessage = (e) => {
      clearTimeout(timer);
      if (e.data.error) setError(e.data.error);
      else setResult(e.data.output);
      stop();
    };
    w.onerror = () => {
      clearTimeout(timer);
      stop();
      setError('处理模块加载失败');
    };
    w.postMessage({ id, input: source, options: opts });
  }
  const blocks: MergeBlock[] = result && id === 'diff' ? JSON.parse(result) : [];
  const ready = !!result && blocks.every((b, i) => !b.conflict || !!chosen[i]);
  const output =
    id === 'diff'
      ? blocks.flatMap((b, i) => b.ok ?? (chosen[i] ? b.conflict![chosen[i]] : [])).join('\n')
      : result;
  let size = 0;
  if (id === 'css-unit')
    try {
      const c = clampValues(opts);
      size = Math.max(Math.min(c.a, c.b), Math.min(Math.max(c.a, c.b), c.intercept + c.slope * width));
    } catch {
      /* invalid fields */
    }
  return (
    <details className="analysis-file" data-upgrade={id}>
      <summary>{spec.title}</summary>
      {id !== 'css-unit' && (
        <label>
          {id === 'diff' ? '本地版本' : id === 'geo-coordinates' ? '起点（经度,纬度）' : '输入内容'}
          <textarea
            rows={4}
            value={source}
            onChange={(e) => {
              clear();
              setSource(e.target.value);
            }}
          />
        </label>
      )}
      <div className="analysis-actions">
        <button
          onClick={() => {
            clear();
            setSource(spec.sample);
            options({ ...spec.options });
          }}
        >
          填入示例
        </button>
        {current !== undefined && id !== 'css-unit' && (
          <button
            onClick={() => {
              clear();
              setSource(current);
            }}
          >
            使用当前输入
          </button>
        )}
        {id !== 'css-unit' && (
          <label>
            读取文件
            <input
              type="file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file)
                  try {
                    const r = await readText(file);
                    clear();
                    setSource(r.text);
                  } catch (err) {
                    setError(String(err));
                  }
              }}
            />
          </label>
        )}
      </div>
      <div className="analysis-fields">
        {Object.entries(spec.labels)
          .filter(([k]) => !(id === 'json' && k === 'target' && opts.patchMode === 'apply'))
          .map(([k, label]) => (
            <label key={k}>
              {typeof label === 'string'
                ? label
                : ({
                    patchMode: '补丁模式（生成 / 应用）',
                    unit: '单位',
                    direction: '转换方向',
                    style: '代码风格',
                    dialect: '方言',
                  }[k] ?? k)}
              {Array.isArray(label) ? (
                <select
                  value={opts[k]}
                  onChange={(e) => {
                    clear();
                    options({ ...o, [k]: e.target.value });
                  }}
                >
                  {label.map((x) => (
                    <option key={x} value={x}>
                      {({ generate: '生成并预演', apply: '应用已有补丁' } as Record<string, string>)[x] ?? x}
                    </option>
                  ))}
                </select>
              ) : ['base', 'third', 'target'].includes(k) ? (
                <textarea
                  value={opts[k]}
                  rows={3}
                  onChange={(e) => {
                    clear();
                    options({ ...o, [k]: e.target.value });
                  }}
                />
              ) : (
                <input
                  value={opts[k]}
                  onChange={(e) => {
                    clear();
                    options({ ...o, [k]: e.target.value });
                  }}
                />
              )}
            </label>
          ))}
      </div>
      {id === 'css-unit' && (
        <label>
          预览视口 {width}px
          <input type="range" min="200" max="2000" value={width} onChange={(e) => resize(+e.target.value)} />
          <span style={{ fontSize: size }}>响应式字号 {size.toFixed(2)}px</span>
        </label>
      )}
      <button className="secondary-button" disabled={busy} onClick={run}>
        {busy ? '处理中…' : '运行'}
      </button>
      {error && <p role="alert">{error}</p>}
      {blocks.map(
        (b, i) =>
          b.conflict && (
            <fieldset key={i}>
              <legend>冲突 {i + 1}</legend>
              {(['o', 'a', 'b'] as const).map((k) => (
                <label key={k}>
                  <input
                    type="radio"
                    checked={chosen[i] === k}
                    onChange={() => choose({ ...chosen, [i]: k })}
                  />
                  {{ a: '本地', b: '对方', o: '祖先' }[k]}
                  <pre>{b.conflict![k].join('\n')}</pre>
                </label>
              ))}
            </fieldset>
          ),
      )}
      {result && (
        <>
          <pre>{output}</pre>
          <div className="analysis-actions">
            <button disabled={!ready} onClick={() => void copyText(output).catch(() => setError('复制失败'))}>
              复制结果
            </button>
            <button
              disabled={!ready}
              onClick={() =>
                void saveText(output, id + '-result.' + spec.ext).catch((e) => setError(String(e)))
              }
            >
              导出结果
            </button>
          </div>
        </>
      )}
    </details>
  );
}
