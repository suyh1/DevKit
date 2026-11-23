import { useEffect, useState } from 'react';
import { Braces, RefreshCw } from 'lucide-react';
import { mockFieldNames, prepareMockResponse } from '../shared/mock-response.mjs';
import CodeEditor from './CodeEditor';
import SegmentedControl from './SegmentedControl';
import Skeleton from './Skeleton';

export type ResponseBody = { format: string; body: string; template?: string; count?: number };
const templates = [
  { name: '订单列表', item: { id: '{{uuid}}', customer: '{{name}}', amount: '{{price}}', createdAt: '{{datetime}}' } },
  { name: '用户列表', item: { id: '{{index}}', name: '{{name}}', email: '{{email}}', city: '{{city}}' } },
  { name: '商品列表', item: { id: '{{uuid}}', name: '{{product}}', price: '{{price}}', stock: '{{quantity}}' } },
].map(({ name, item }) => ({ name, body: JSON.stringify({ items: [item] }, null, 2) }));
export const defaultGeneration = { format: 'generated', template: templates[0].body, count: 5 };

function Preview({ body, count }: { body: string; count: number }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ json?: string; error?: string }>();
  useEffect(() => {
    let current = true;
    async function generate() {
      try {
        const data = await prepareMockResponse(body, count)();
        if (current) setResult({ json: JSON.stringify(data, null, 2) });
      } catch (error) {
        if (current) setResult({ error: (error as Error).message });
      }
    }
    setResult(undefined);
    void generate();
    return () => { current = false; };
  }, [body, count, revision]);
  return <div className="mock-preview">
    <button type="button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />重新生成</button>
    {result?.error ? <p role="alert">{result.error}</p> : result?.json !== undefined
      ? <CodeEditor label="预览响应" language="json" value={result.json} readOnly wrap />
      : <Skeleton label="正在生成预览" />}
  </div>;
}

export default function MockResponseEditor({ scenario, disabled, change }: {
  scenario: ResponseBody & { status: number }; disabled: boolean; change: (values: Partial<ResponseBody>) => void;
}) {
  const [view, setView] = useState<'template' | 'preview'>('template');
  const generated = scenario.format === 'generated';
  const template = scenario.template ?? defaultGeneration.template;
  const count = scenario.count ?? defaultGeneration.count;
  const hasBody = ![204, 205, 304].includes(scenario.status);
  return <section className="mock-response-editor">
    <div className="mock-response-bar">
      <strong><Braces size={16} />响应正文</strong>
      <SegmentedControl label="响应格式" value={scenario.format} disabled={disabled}
        options={[{ value: 'generated', label: '自动生成' }, { value: 'json', label: '固定 JSON' }, { value: 'text', label: '纯文本' }]}
        onChange={format => { setView('template'); change(format === 'generated' ? { format, template, count } : { format }); }} />
    </div>
    {generated && <div className="mock-generation">
      <label>套用模板<select disabled={disabled} value={templates.find(item => item.body === template)?.name ?? ''}
        onChange={event => { change({ template: templates.find(item => item.name === event.target.value)!.body }); setView('template'); }}>
        <option value="" disabled>自定义模板</option>
        {templates.map(item => <option key={item.name}>{item.name}</option>)}
      </select></label>
      <label>列表条数<input disabled={disabled} type="number" min={1} max={100} value={count || ''} onChange={event => change({ count: Number(event.target.value) })} /></label>
    </div>}
    <div className="mock-code-panel">
      <div>
        {generated ? <SegmentedControl label="生成视图" value={view} onChange={setView}
          options={[{ value: 'template', label: 'JSON 模板' }, { value: 'preview', label: '预览响应' }]} />
          : <strong>{scenario.format === 'json' ? 'JSON' : '纯文本'}</strong>}
        <small>{generated ? '每次请求生成' : scenario.body.split('\n').length + ' 行'}</small>
      </div>
      {generated && view === 'preview' ? hasBody ? <Preview body={template} count={count} /> : <p>HTTP {scenario.status} 响应没有正文。</p>
        : <CodeEditor label={generated ? 'JSON 模板' : '响应正文'} language={scenario.format === 'text' ? 'text' : 'json'}
          readOnly={disabled} value={generated ? template : scenario.body}
          onChange={value => change(generated ? { template: value } : { body: value })} wrap />}
    </div>
    {generated && <details className="mock-fields-help"><summary>可用字段与列表规则</summary>
      <p>把占位符作为完整的字符串值。普通 JSON 值原样返回。根数组或根对象下的数组只有一个元素时，按列表条数重复生成。</p>
      <div>{mockFieldNames.map(name => <code key={name}>{'{{' + name + '}}'}</code>)}</div>
    </details>}
  </section>;
}
