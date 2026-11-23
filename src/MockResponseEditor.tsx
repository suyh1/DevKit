import FloatingDetails from './FloatingDetails';
import { TextArea } from './TextControl';
import { useEffect, useId, useState } from 'react';
import { Braces, RefreshCw } from 'lucide-react';
import { mockFieldNames, prepareMockResponse } from '../shared/mock-response.mjs';
import { generateSchemaResponse, resolveSchemaObject } from '../shared/mock-schema.mjs';
import { validField, type FieldHint, type MockContext } from '../shared/mock-request.mjs';
import CodeEditor from './CodeEditor';
import SegmentedControl from './SegmentedControl';
import Skeleton from './Skeleton';

export type ResponseBody = {
  format: string;
  body: string;
  schema?: string;
  template?: string;
  count?: number;
};
const templates = [
  {
    name: '订单列表',
    item: { id: '{{uuid}}', customer: '{{name}}', amount: '{{price}}', createdAt: '{{datetime}}' },
  },
  { name: '用户列表', item: { id: '{{index}}', name: '{{name}}', email: '{{email}}', city: '{{city}}' } },
  {
    name: '商品列表',
    item: { id: '{{uuid}}', name: '{{product}}', price: '{{price}}', stock: '{{quantity}}' },
  },
].map(({ name, item }) => ({ name, body: JSON.stringify({ items: [item] }, null, 2) }));
export const defaultGeneration = { format: 'generated', template: templates[0].body, count: 5 };

function bindRequestField(text: string, schema: boolean, source: string, key: string) {
  if (!validField(source, key)) throw new Error('字段名无效，或属于受保护的请求头。');
  const ref = 'request.' + source + '.' + key;
  const dest = key.split('.').at(-1)!;
  const document = JSON.parse(text);
  let target = document;
  let value: unknown = '{{' + ref + '}}';
  if (schema) {
    target = resolveSchemaObject(document, document);
    if (target?.type === 'array') target = resolveSchemaObject(document, target.items);
    target = target?.properties;
    if (!target || Array.isArray(target) || typeof target !== 'object')
      throw new Error('请选择含 properties 的对象 Schema，或直接编辑嵌套属性。');
    value = { ...(Object.hasOwn(target, dest) ? target[dest] : { type: 'string' }), 'x-devkit-request': ref };
  } else {
    if (Array.isArray(document)) target = document[0];
    else if (Array.isArray(document?.items)) target = document.items[0];
    if (!target || typeof target !== 'object' || Array.isArray(target))
      throw new Error('请在模板中放入一个对象，或直接编辑占位符。');
  }
  Object.defineProperty(target, dest, { value, enumerable: true, configurable: true });
  return JSON.stringify(document, null, 2);
}

function Preview({
  body,
  count,
  schema,
  context,
}: {
  body: string;
  count: number;
  schema: boolean;
  context: string;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ json?: string; error?: string }>();
  useEffect(() => {
    let current = true;
    async function generate() {
      try {
        let request: MockContext;
        try {
          request = JSON.parse(context);
        } catch {
          throw new Error('预览请求必须是有效 JSON。');
        }
        const data = schema
          ? await generateSchemaResponse(body, request)
          : await prepareMockResponse(body, count)(request);
        if (current) setResult({ json: JSON.stringify(data, null, 2) });
      } catch (error) {
        if (current) setResult({ error: (error as Error).message });
      }
    }
    setResult(undefined);
    void generate();
    return () => {
      current = false;
    };
  }, [body, count, schema, context, revision]);
  return (
    <div className="mock-preview">
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        <RefreshCw size={14} />
        重新生成
      </button>
      {result?.error ? (
        <p role="alert">{result.error}</p>
      ) : result?.json !== undefined ? (
        <CodeEditor label="预览响应" language="json" value={result.json} readOnly wrap />
      ) : (
        <Skeleton label="正在生成预览" />
      )}
    </div>
  );
}

export default function MockResponseEditor({
  scenario,
  path,
  fields = [],
  disabled,
  change,
}: {
  scenario: ResponseBody & { status: number };
  path: string;
  fields?: FieldHint[];
  disabled: boolean;
  change: (values: Partial<ResponseBody>) => void;
}) {
  const [view, setView] = useState<'template' | 'preview'>('template');
  const generated = scenario.format === 'generated';
  const schema = scenario.format === 'schema';
  const dynamic = generated || schema;
  const schemaText = scenario.schema ?? '{"type":"object","properties":{"id":{"type":"integer"}}}';
  const [requestDraft, setRequestDraft] = useState<string>();
  const [source, setSource] = useState('path'),
    [field, setField] = useState('');
  const [fieldError, setFieldError] = useState('');
  const suggestionsId = useId();
  const params = Array.from(
    path.matchAll(/(?:^|\/)(?::(\w+)|\{(\w+)\})(?=\/|$)/g),
    (match) => match[1] || match[2],
  );
  const context =
    requestDraft ??
    JSON.stringify(
      { path: Object.fromEntries(params.map((key) => [key, '42'])), query: {}, header: {}, body: {} },
      null,
      2,
    );
  const template = scenario.template ?? defaultGeneration.template;
  const count = scenario.count ?? defaultGeneration.count;
  const hasBody = ![204, 205, 304].includes(scenario.status);
  return (
    <section className="mock-response-editor">
      <div className="mock-response-bar">
        <strong>
          <Braces size={16} />
          响应正文
        </strong>
        <SegmentedControl
          label="响应格式"
          value={scenario.format}
          disabled={disabled}
          options={[
            { value: 'generated', label: '自动生成' },
            { value: 'schema', label: 'Schema' },
            { value: 'json', label: '固定 JSON' },
            { value: 'text', label: '纯文本' },
          ]}
          onChange={(format) => {
            setView('template');
            change(
              format === 'generated'
                ? { format, template, count }
                : format === 'schema'
                  ? { format, schema: schemaText }
                  : { format },
            );
          }}
        />
      </div>
      {generated && (
        <div className="mock-generation">
          <label>
            套用模板
            <select
              disabled={disabled}
              value={templates.find((item) => item.body === template)?.name ?? ''}
              onChange={(event) => {
                change({ template: templates.find((item) => item.name === event.target.value)!.body });
                setView('template');
              }}
            >
              <option value="" disabled>
                自定义模板
              </option>
              {templates.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            列表条数
            <input
              disabled={disabled}
              type="number"
              min={1}
              max={100}
              value={count || ''}
              onChange={(event) => change({ count: Number(event.target.value) })}
            />
          </label>
        </div>
      )}
      <div className="mock-code-panel">
        <div>
          {dynamic ? (
            <SegmentedControl
              label="生成视图"
              value={view}
              onChange={setView}
              options={[
                { value: 'template', label: schema ? '响应 Schema' : 'JSON 模板' },
                { value: 'preview', label: '预览响应' },
              ]}
            />
          ) : (
            <strong>{scenario.format === 'json' ? 'JSON' : '纯文本'}</strong>
          )}
          <small>{dynamic ? '每次请求生成' : scenario.body.split('\n').length + ' 行'}</small>
        </div>
        {dynamic && view === 'preview' ? (
          hasBody ? (
            <Preview body={schema ? schemaText : template} count={count} schema={schema} context={context} />
          ) : (
            <p>HTTP {scenario.status} 响应没有正文。</p>
          )
        ) : (
          <CodeEditor
            label={schema ? '响应 Schema' : generated ? 'JSON 模板' : '响应正文'}
            language={scenario.format === 'text' ? 'text' : 'json'}
            readOnly={disabled}
            value={schema ? schemaText : generated ? template : scenario.body}
            onChange={(value) =>
              change(schema ? { schema: value } : generated ? { template: value } : { body: value })
            }
            wrap
          />
        )}
      </div>
      {dynamic && (
        <FloatingDetails className="mock-fields-help">
          <summary>请求字段与预览参数</summary>
          <div className="mock-generation">
            <label>
              来源
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setField('');
                }}
              >
                {Object.entries({
                  path: '路径参数',
                  query: '查询参数',
                  header: '请求头',
                  body: 'JSON 正文',
                }).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              字段
              <input
                list={suggestionsId}
                value={field}
                placeholder={source === 'body' ? 'order.amount' : source === 'query' ? 'page' : 'id'}
                onChange={(e) => setField(e.target.value)}
              />
            </label>
            <datalist id={suggestionsId}>
              {[
                ...new Set([
                  ...(source === 'path' ? params : []),
                  ...fields.filter((f) => f.source === source).map((f) => f.key),
                ]),
              ].map((key) => (
                <option key={key}>{key}</option>
              ))}
            </datalist>
            <button
              type="button"
              disabled={disabled || !field.trim()}
              onClick={() => {
                try {
                  const value = bindRequestField(schema ? schemaText : template, schema, source, field.trim());
                  change(schema ? { schema: value } : { template: value });
                  setView('template');
                  setFieldError('');
                } catch (error) {
                  setFieldError((error as Error).message);
                }
              }}
            >
              填入响应字段
            </button>
          </div>
          {fieldError && <p role="alert">{fieldError}</p>}
          <label>
            预览请求（JSON）
            <TextArea rows={4} value={context} onChange={(e) => setRequestDraft(e.target.value)} />
          </label>
        </FloatingDetails>
      )}
      {generated && (
        <FloatingDetails className="mock-fields-help">
          <summary>可用字段与列表规则</summary>
          <p>
            把占位符作为完整的字符串值。普通 JSON
            值原样返回。根数组或根对象下的数组只有一个元素时，按列表条数重复生成。
          </p>
          <div>
            {mockFieldNames.map((name) => (
              <code key={name}>{'{{' + name + '}}'}</code>
            ))}
          </div>
        </FloatingDetails>
      )}
    </section>
  );
}
