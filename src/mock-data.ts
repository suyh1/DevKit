import type { Options } from './tools';
import { jsonTree } from './result-model';
import { jsonToCsv } from './utilities';

type Rule = string | { kind: string; min?: number; max?: number; values?: (string | number | boolean | null)[] };
type Schema = { type?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[]; enum?: unknown[]; const?: unknown; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; format?: string; [key: string]: unknown };
const generators = ['name', 'email', 'phone', 'city', 'address', 'uuid', 'date', 'word', 'integer', 'number', 'boolean', 'sequence', 'pick'];
const schemaKeys = new Set(['$schema', 'title', 'description', 'examples', 'default', 'type', 'properties', 'items', 'required', 'additionalProperties', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'format']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function seedNumber(seed: string) { let hash = 2166136261; for (const c of seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return hash >>> 0; }
function bounds(min: unknown, max: unknown, low: number, high: number, integer = false): [number, number] {
  if (min !== undefined && typeof min !== 'number' || max !== undefined && typeof max !== 'number') throw new Error('生成范围必须使用数字。');
  const a = min === undefined ? low : Number(min), b = max === undefined ? high : Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || integer && (!Number.isSafeInteger(a) || !Number.isSafeInteger(b))) throw new Error('生成范围无效。');
  return [a, b];
}
export async function generateMock(input: string, options: Options): Promise<string> {
  const count = Number(options.count ?? 10);
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('生成数量必须是 1–1,000。');
  if (!['example', 'schema'].includes(options.source || 'example') || !['json', 'csv'].includes(options.format || 'json')) throw new Error('生成模式无效。');
  const tree = jsonTree(input);
  if ((options.seed || '').length > 200) throw new Error('随机种子最多 200 字符。');
  function noDuplicates(node: typeof tree) {
    if (node.kind === 'object' && new Set(node.children.map(child => child.key)).size !== node.children.length) throw new Error('输入有重复字段。');
    node.children.forEach(child => noDuplicates(child.node));
  }
  noDuplicates(tree);
  function safeNumbers(node: typeof tree) {
    if (node.kind === 'value' && /^-?\d/.test(node.raw)) {
      const value = Number(node.raw);
      if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('Mock 输入含超出安全数值范围的数字，请改为字符串。');
    }
    node.children.forEach(child => safeNumbers(child.node));
  }
  safeNumbers(tree);
  const source: unknown = JSON.parse(input);
  const ruleTree = jsonTree(options.rules || '{}', { length: 30_000, nodes: 1000 }); noDuplicates(ruleTree);
  const parsedRules: unknown = JSON.parse(options.rules || '{}');
  if (!record(parsedRules)) throw new Error('字段规则必须为 JSON 对象。');
  const rules = parsedRules;
  const used = new Set<string>();
  for (const value of Object.values(rules)) {
    const kind = typeof value === 'string' ? value : record(value) ? value.kind : '';
    if (!generators.includes(String(kind))) throw new Error(`不支持的字段生成规则：${String(kind)}`);
    if (record(value) && Object.keys(value).some(key => !['kind', 'min', 'max', 'values'].includes(key))) throw new Error('字段规则只支持 kind、min、max、values。');
  }
  const { faker } = await import('@faker-js/faker/locale/zh_CN');
  faker.seed(seedNumber((options.seed || 'devkit').slice(0, 200)));
  faker.setDefaultRefDate('2026-01-01T00:00:00.000Z');
  let budget = 100_000;
  function generateRule(rule: Rule, index: number) {
    const config = typeof rule === 'string' ? { kind: rule } : rule;
    switch (config.kind) {
      case 'name': return faker.person.fullName();
      case 'email': return faker.internet.email();
      case 'phone': return faker.phone.number();
      case 'city': return faker.location.city();
      case 'address': return faker.location.streetAddress();
      case 'uuid': return faker.string.uuid();
      case 'date': return faker.date.between({ from: '2020-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' }).toISOString();
      case 'word': return faker.lorem.word();
      case 'sequence': return index + 1;
      case 'boolean': return faker.datatype.boolean();
      case 'pick': if (!Array.isArray(config.values) || !config.values.length || config.values.length > 100 || config.values.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) throw new Error('pick 需要 1–100 个标量 values。'); return faker.helpers.arrayElement(config.values);
      case 'integer': { const [min, max] = bounds(config.min, config.max, 0, 1000, true); return faker.number.int({ min, max }); }
      case 'number': { const [min, max] = bounds(config.min, config.max, 0, 1000); return faker.number.float({ min, max, fractionDigits: 2 }); }
      default: throw new Error('未知规则。');
    }
  }
  function build(value: unknown, path: string, index: number, depth = 0): unknown {
    if (--budget < 0 || depth > 20) throw new Error('Mock 超过 100,000 节点或 20 层，请缩小数量或结构。');
    if (Object.hasOwn(rules, path)) { used.add(path); return generateRule(rules[path] as Rule, index); }
    if (options.source !== 'schema') {
      if (Array.isArray(value)) return value.length ? [build(value[0], `${path}[]`, index, depth + 1)] : [];
      if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, build(child, path ? `${path}.${key}` : key, index, depth + 1)]));
      if (typeof value === 'number') return faker.number.int({ min: 0, max: 10000 });
      if (typeof value === 'boolean') return faker.datatype.boolean();
      if (value === null) return null;
      if (typeof value !== 'string') throw new Error('示例包含不支持的值。');
      const key = path.split('.').at(-1) || '';
      if (/^(name|姓名|用户名)$/i.test(key)) return generateRule('name', index);
      if (/email|邮箱/i.test(key)) return generateRule('email', index);
      if (/phone|mobile|电话|手机/i.test(key)) return generateRule('phone', index);
      if (/city|城市/i.test(key)) return generateRule('city', index);
      return faker.lorem.word();
    }
    if (!record(value)) throw new Error(`${path || '$'} Schema 必须为对象。`);
    const schema = value as Schema;
    if (Object.keys(schema).some(key => !schemaKeys.has(key))) throw new Error(`${path || '$'} 包含不支持的 Schema 关键字；本工具支持常用生成子集，不是完整校验器。`);
    if (Object.hasOwn(schema, 'const') || Object.hasOwn(schema, 'enum')) {
      if (Object.keys(schema).some(key => !['const', 'enum', 'type', '$schema', 'title', 'description', 'examples', 'default'].includes(key))) throw new Error('const/enum 暂不支持叠加其他生成约束。');
      const values = Object.hasOwn(schema, 'const') ? [schema.const] : schema.enum;
      if (!Array.isArray(values) || !values.length || values.length > 100) throw new Error('enum 需要 1–100 项。');
      if (schema.enum && values.some(value => !schema.enum!.some(entry => JSON.stringify(entry) === JSON.stringify(value)))) throw new Error('const 与 enum 不一致。');
      const matches = (value: unknown) => schema.type === undefined || schema.type === 'null' ? schema.type === undefined || value === null : schema.type === 'array' ? Array.isArray(value) : schema.type === 'object' ? record(value) : schema.type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value) : typeof value === schema.type;
      if (values.some(value => !matches(value))) throw new Error('const/enum 与 type 不兼容。');
      return structuredClone(faker.helpers.arrayElement(values));
    }
    const type = schema.type || (schema.properties ? 'object' : '');
    if (type === 'object') {
      if (!record(schema.properties || {})) throw new Error('properties 必须为对象。');
      if (schema.additionalProperties !== undefined && schema.additionalProperties !== false && schema.additionalProperties !== true) throw new Error('additionalProperties 只支持布尔值。');
      if (schema.required && (!Array.isArray(schema.required) || schema.required.some(key => !Object.hasOwn(schema.properties || {}, key)))) throw new Error('required 必须引用已定义的 properties。');
      return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [key, build(child, path ? `${path}.${key}` : key, index, depth + 1)]));
    }
    if (type === 'array') {
      const [min, max] = bounds(schema.minItems, schema.maxItems, Math.min(1, schema.maxItems ?? 1), Math.max(1, schema.minItems || 0), true);
      if (min < 0 || max > 50 || !record(schema.items)) throw new Error('数组需提供 items，minItems/maxItems 范围为 0–50。');
      return Array.from({ length: min }, () => build(schema.items, `${path}[]`, index, depth + 1));
    }
    if (type === 'null') return null;
    if (type === 'boolean') return faker.datatype.boolean();
    if (type === 'integer' || type === 'number') {
      const [min, max] = bounds(schema.minimum, schema.maximum, Math.min(0, schema.maximum ?? 0), Math.max(1000, schema.minimum || 0), type === 'integer');
      return type === 'integer' ? faker.number.int({ min, max }) : faker.number.float({ min, max });
    }
    if (type === 'string') {
      const [min, max] = bounds(schema.minLength, schema.maxLength, Math.min(8, schema.maxLength ?? 8), Math.max(20, schema.minLength || 0), true);
      if (min < 0 || max > 1000) throw new Error('字符串长度范围为 0–1,000。');
      let result: string;
      switch (schema.format) {
        case undefined: result = faker.string.alpha({ length: min }); break;
        case 'email': result = faker.internet.email(); break;
        case 'uuid': result = faker.string.uuid(); break;
        case 'date-time': result = generateRule('date', index) as string; break;
        case 'date': result = (generateRule('date', index) as string).slice(0, 10); break;
        case 'uri': result = `https://example.com/${faker.string.alpha(8)}`; break;
        default: throw new Error(`不支持的 format：${schema.format}`);
      }
      if (schema.minLength !== undefined && result.length < min || schema.maxLength !== undefined && result.length > max) throw new Error('format 与长度约束不兼容。');
      return result;
    }
    throw new Error(`${path || '$'} 需要明确且受支持的 type。`);
  }
  const example = options.source !== 'schema' && Array.isArray(source) ? source[0] : source;
  if (example === undefined) throw new Error('示例数组至少需要一个元素。');
  const data: unknown[] = []; let size = 0;
  for (let index = 0; index < count; index++) {
    const row = build(example, '', index); size += JSON.stringify(row).length;
    if (size > 3_000_000) throw new Error('Mock 结果超过安全大小，请缩小记录数量。');
    data.push(row);
  }
  const unused = Object.keys(rules).filter(key => !used.has(key));
  if (unused.length) throw new Error(`字段规则未匹配：${unused.join('、')}`);
  const result = JSON.stringify(data, null, 2);
  if (result.length > 4_000_000) throw new Error('Mock 结果超过 4,000,000 字符。');
  return options.format === 'csv' ? jsonToCsv(result, { delimiter: 'comma', excelSafe: 'on' }) : result;
}
