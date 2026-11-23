import CodeEditor from './CodeEditor';
export type Dataset = { template: string; count: number; writable: boolean };
export const orderDataset: Dataset = {
  template: JSON.stringify(
    [{ id: '{{index}}', customer: '{{name}}', amount: '{{price}}', status: 'pending' }],
    null,
    2,
  ),
  count: 5,
  writable: false,
};
export default function MockDatasetEditor({
  dataset,
  size,
  saved,
  disabled,
  change,
  reset,
}: {
  dataset: Dataset;
  size?: number;
  saved: boolean;
  disabled: boolean;
  change: (value: Dataset) => void;
  reset: () => void;
}) {
  return (
    <section className="mock-response-editor">
      <div className="mock-response-bar">
        <strong>项目数据集</strong>
        <small>{saved ? (size ?? 0) + ' 条记录' : '首次保存时生成'}</small>
      </div>
      <div className="mock-code-panel">
        <div>
          <strong>初始记录模板</strong>
        </div>
        <CodeEditor
          label="初始记录模板"
          language="json"
          value={dataset.template}
          readOnly={disabled || saved}
          onChange={(template) => change({ ...dataset, template })}
          wrap
        />
      </div>
      <div className="mock-generation">
        <label>
          初始条数
          <input
            type="number"
            min={1}
            max={100}
            disabled={disabled || saved}
            value={dataset.count || ''}
            onChange={(e) => change({ ...dataset, count: Number(e.target.value) })}
          />
        </label>
        {saved && !disabled && <button onClick={reset}>恢复初始数据</button>}
      </div>
      <label className="collab-check">
        <input
          type="checkbox"
          role="switch"
          className="liquid-toggle"
          disabled={disabled}
          checked={dataset.writable}
          onChange={(e) => change({ ...dataset, writable: e.target.checked })}
        />
        允许持调用地址者新增、修改和删除记录
      </label>
      <small>
        GET 集合路径读取列表，在路径后加 /记录ID 读取详情。开启写入后可用 POST 新增、PATCH 或 PUT 修改、DELETE
        删除。
      </small>
    </section>
  );
}
