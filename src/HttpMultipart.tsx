import { TextInput } from './TextControl';
import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { multipartLimits } from '../shared/http-multipart.mjs';
import type { HttpInput } from './http-model';
import './http-builder.css';

export type MultipartField = { name: string; value: string; kind: 'text' | 'file'; file?: File };
export const multipartField = (): MultipartField => ({ name: '', value: '', kind: 'text' });
export function multipartIssue(fields: MultipartField[]) {
  if (fields.some(row => !row.name.trim() || row.name.length > 255 || /[\x00-\x1f\x7f]/.test(row.name) || row.kind === 'file' && !row.file)) return '请填写字段名称并为文件项选择附件。';
  const sizes = fields.map(row => row.kind === 'file' ? row.file?.size || 0 : new TextEncoder().encode(row.value).length);
  if (sizes.some(size => size > multipartLimits.part) || sizes.reduce((sum, size) => sum + size, 0) > multipartLimits.total) return '每项最多 1 MB，含表单协议总计最多 2 MB。';
  return '';
}

export async function withMultipart(input: HttpInput, fields: MultipartField[] | null): Promise<HttpInput> {
  if (!fields) return input;
  const issue = multipartIssue(fields);
  if (issue) throw new Error(issue);
  if (['GET', 'HEAD'].includes(input.method)) throw new Error('GET/HEAD 不支持 multipart 正文。');
  const multipart = await Promise.all(fields.map(async row => {
    if (row.kind === 'text') return { name: row.name, value: row.value };
    const file = row.file!, bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { name: row.name, file: { name: file.name, type: file.type, data: btoa(binary) } };
  }));
  return { ...input, body: '', multipart };
}

export default function HttpMultipart({ fields, change, disabled }: { fields: MultipartField[] | null; change: (rows: MultipartField[] | null) => void; disabled: boolean }) {
  const join = useId();
  const issue = fields && multipartIssue(fields);
  const patch = (position: number, next: Partial<MultipartField>) => change(fields!.map((row, index) => index === position ? { ...row, ...next } : row));
  return <fieldset className="http-multipart" disabled={disabled}>
    <legend>请求体上传</legend>
    <label><input role="switch" className="liquid-toggle" type="checkbox" checked={!!fields} onChange={event => change(event.target.checked ? [multipartField()] : null)} /> multipart/form-data</label>
    {fields && <>
      <p className="preview-note">发送时使用以下表单字段和文件。选中的内容仅保留在当前页面。每项最多 1 MB，整份表单最多 2 MB。</p>
      {fields.map((row, index) => <div className="http-multipart-row" key={index}>
        <TextInput aria-label={`表单字段名称 ${index + 1}`} placeholder="字段名" value={row.name} maxLength={255} onChange={event => patch(index, { name: event.target.value })} />
        <select aria-label={`表单字段类型 ${index + 1}`} value={row.kind} onChange={event => patch(index, { kind: event.target.value === 'file' ? 'file' : 'text', file: undefined })}><option value="text">文本</option><option value="file">文件</option></select>
        {row.kind === 'text' ? <TextInput aria-label={`表单字段值 ${index + 1}`} placeholder="文本值" value={row.value} onChange={event => patch(index, { value: event.target.value })} /> : <div><label className="file-pick-button" htmlFor={`${join}-${index}`}>选择文件</label><input id={`${join}-${index}`} className="sr-only" type="file" aria-label={`选择表单文件 ${index + 1}`} onChange={event => { patch(index, { file: event.target.files?.[0] }); event.target.value = ''; }} /><small>{row.file ? `${row.file.name} · ${row.file.size.toLocaleString()} B` : '未选择文件'}</small></div>}
        <button type="button" className="icon-button" aria-label={`移除表单字段 ${index + 1}`} onClick={() => change(fields.length > 1 ? fields.filter((_, i) => index !== i) : [multipartField()])}><Trash2 size={14} /></button>
      </div>)}
      <button type="button" className="text-button" disabled={fields.length >= multipartLimits.rows} onClick={() => change([...fields, multipartField()])}><Plus size={14} />添加表单字段</button>
      {issue && <p className="preview-note">{issue}</p>}
      <details><summary>表单预览</summary><ul className="disclosure-scroll">{fields.map((row, index) => <li key={index}>{row.name || '未命名字段'} · {row.kind === 'file' ? row.file?.name || '未选择文件' : `${new TextEncoder().encode(row.value).length} B 文本`}</li>)}</ul><small>请求会自动添加 Content-Type 和边界。</small></details>
    </>}
  </fieldset>;
}
