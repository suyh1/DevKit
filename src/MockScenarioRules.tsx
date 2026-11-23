import type { Rule } from '../shared/mock-request.mjs';
const labels = { query: '查询参数', path: '路径参数', header: '请求头', body: 'JSON 正文' };
export default function MockScenarioRules({
  rules,
  change,
  disabled,
}: {
  rules: Rule[];
  change: (rules: Rule[]) => void;
  disabled: boolean;
}) {
  function update(index: number, patch: Partial<Rule>) {
    change(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }
  return (
    <details className="mock-match">
      <summary>
        场景匹配条件 <small>{rules.length ? rules.length + ' 项全部满足' : '无条件'}</small>
      </summary>
      {rules.map((rule, i) => (
        <div key={i} className="mock-rule-row">
          <label>
            来源
            <select
              value={rule.source}
              onChange={(e) => update(i, { source: e.target.value as Rule['source'] })}
            >
              {Object.entries(labels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            字段
            <input
              value={rule.key}
              placeholder={rule.source === 'body' ? 'order.quantity' : 'mode'}
              onChange={(e) => update(i, { key: e.target.value })}
            />
          </label>
          <label>
            等于
            <input value={rule.value} onChange={(e) => update(i, { value: e.target.value })} />
          </label>
          {!disabled && (
            <button
              type="button"
              aria-label={'移除条件 ' + (i + 1)}
              onClick={() => change(rules.filter((_, j) => j !== i))}
            >
              移除
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          disabled={rules.length >= 8}
          onClick={() => change([...rules, { source: 'query', key: '', value: '' }])}
        >
          添加条件
        </button>
      )}
    </details>
  );
}
