import { permissionValue } from './tool-experience';
import type { Options, ToolId } from './tools';

type Props = { id: ToolId; value: string; options: Options; label: string; placeholder?: string; disabled: boolean; onChange: (value: string) => void };
export default function ToolInput({ id, value, label, placeholder, disabled, onChange }: Props) {
  const permissions = permissionValue(value || '0000');
  const changeBit = (bit: number) => onChange(((permissions ?? 0) ^ bit).toString(8).padStart(4, '0'));
  const multiline = ['jwt', 'ulid', 'css-unit'].includes(id);
  return <div className={`focused-input input-${id}`}>
    <label><span>{label}</span>{multiline ? <textarea aria-label="输入内容" value={value} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder={placeholder} spellCheck={false} rows={id === 'jwt' ? 4 : 3} /> : <input aria-label="输入内容" value={value} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder={placeholder} spellCheck={false} />}</label>
    {id === 'timestamp' && <button className="secondary-button" disabled={disabled} onClick={() => onChange(new Date().toISOString())}>填入当前时间</button>}
    {id === 'cron' && <><div className="cron-fields">{['分', '时', '日', '月', '周'].map((name, index) => <div key={name}><code>{value.trim().split(/\s+/)[index] || '—'}</code><span>{name}</span></div>)}</div><div className="input-presets">{[['每 15 分钟', '*/15 * * * *'], ['每天 9 点', '0 9 * * *'], ['工作日 9 点', '0 9 * * 1-5']].map(([name, expression]) => <button className="secondary-button" key={name} disabled={disabled} onClick={() => onChange(expression)}>{name}</button>)}</div></>}
    {id === 'ipv4' && <div className="input-presets">{['192.168.1.42/24', '10.0.0.1/16', '192.168.1.0/31'].map(cidr => <button className="secondary-button" disabled={disabled} key={cidr} onClick={() => onChange(cidr)}>{cidr}</button>)}</div>}
    {id === 'http-status' && <div className="input-presets">{['200', '301', '400', '401', '403', '404', '500', '503'].map(code => <button className="secondary-button" disabled={disabled} key={code} onClick={() => onChange(code)}>{code}</button>)}</div>}
    {id === 'chmod' && <><fieldset className="permission-matrix" disabled={disabled || permissions === null}><legend>权限矩阵</legend><div className="permission-head"><span>角色</span><span>读取 r</span><span>写入 w</span><span>执行 x</span></div>{['所有者', '所属组', '其他人'].map((role, index) => <div key={role}><strong>{role}</strong>{[4, 2, 1].map((bit, position) => <label key={bit}><input type="checkbox" aria-label={`${role}${['读取', '写入', '执行'][position]}`} checked={permissions !== null && !!(permissions & (bit << (6 - index * 3)))} onChange={() => changeBit(bit << (6 - index * 3))} /></label>)}</div>)}<div className="permission-special">{[['setuid', 0o4000], ['setgid', 0o2000], ['sticky', 0o1000]].map(([name, bit]) => <label key={name}><input type="checkbox" checked={permissions !== null && !!(permissions & Number(bit))} onChange={() => changeBit(Number(bit))} />{name}</label>)}</div></fieldset>{permissions === null && <p className="preview-note">输入有效权限后可使用矩阵；也可清空后从矩阵构造。</p>}</>}
  </div>;
}
