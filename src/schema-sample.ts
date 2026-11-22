import { validateLocalSchema } from './api-schema-validation';
import type { Schema } from '@cfworker/json-schema';

export function validateSample(source: string, input: string) {
  let schema: Schema | boolean;
  try { schema = JSON.parse(source); }
  catch { throw new Error('Schema 定义无效，请输入有效的 JSON。'); }
  try { JSON.parse(input); }
  catch { throw new Error('样本格式无效，请输入有效的 JSON。'); }
  if (typeof schema !== 'boolean' && (!schema || typeof schema !== 'object' || Array.isArray(schema)))
    throw new Error('Schema 定义无效，需要对象或布尔值。');
  if (typeof schema === 'object' && schema.$schema && schema.$schema !== 'https://json-schema.org/draft/2020-12/schema')
    return '无法判定\n请选择 Draft 2020-12 Schema。';
  const numbers = source.replace(/"(?:\\.|[^"\\])*"/g, '').match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  if (numbers.some(token => !Number.isFinite(Number(token)) || Number.isInteger(Number(token)) && !Number.isSafeInteger(Number(token))))
    return '无法判定\nSchema 包含超出安全范围的数值。';
  const result = validateLocalSchema(schema, input);
  if (result.state === 'pass') return '校验通过';
  if (result.state === 'skip') return '无法判定\n' + result.detail;
  if (result.invalidSchema) throw new Error('Schema 定义无效\n' + result.detail);
  return '样本不合规\n' + result.detail;
}
