import { validField, requestValue } from './mock-request.mjs';
const schemaKeys = new Set([
  '$schema',
  'title',
  'description',
  'examples',
  'default',
  'type',
  'properties',
  'items',
  'required',
  'additionalProperties',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'format',
]);
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
export function bounds(min, max, low, high, integer = false) {
  if ((min !== undefined && typeof min !== 'number') || (max !== undefined && typeof max !== 'number'))
    throw new Error('生成范围必须使用数字。');
  const a = min === undefined ? low : Number(min),
    b = max === undefined ? high : Number(max);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a > b ||
    (integer && (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)))
  )
    throw new Error('生成范围无效。');
  return [a, b];
}

export function buildSchemaNode(value, path, index, depth, build, faker, date) {
  if (!record(value)) throw new Error(`${path || '$'} Schema 必须为对象。`);
  const schema = value;
  if (Object.keys(schema).some((key) => !schemaKeys.has(key)))
    throw new Error(`${path || '$'} 包含不支持的 Schema 关键字；本工具支持常用生成子集，不是完整校验器。`);
  if (Object.hasOwn(schema, 'const') || Object.hasOwn(schema, 'enum')) {
    if (
      Object.keys(schema).some(
        (key) =>
          !['const', 'enum', 'type', '$schema', 'title', 'description', 'examples', 'default'].includes(key),
      )
    )
      throw new Error('const/enum 暂不支持叠加其他生成约束。');
    const values = Object.hasOwn(schema, 'const') ? [schema.const] : schema.enum;
    if (!Array.isArray(values) || !values.length || values.length > 100)
      throw new Error('enum 需要 1–100 项。');
    if (
      schema.enum &&
      values.some((value) => !schema.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value)))
    )
      throw new Error('const 与 enum 不一致。');
    const matches = (value) =>
      schema.type === undefined || schema.type === 'null'
        ? schema.type === undefined || value === null
        : schema.type === 'array'
          ? Array.isArray(value)
          : schema.type === 'object'
            ? record(value)
            : schema.type === 'integer'
              ? typeof value === 'number' && Number.isSafeInteger(value)
              : typeof value === schema.type;
    if (values.some((value) => !matches(value))) throw new Error('const/enum 与 type 不兼容。');
    return structuredClone(faker.helpers.arrayElement(values));
  }
  const type = schema.type || (schema.properties ? 'object' : '');
  if (type === 'object') {
    if (!record(schema.properties || {})) throw new Error('properties 必须为对象。');
    if (
      schema.additionalProperties !== undefined &&
      schema.additionalProperties !== false &&
      schema.additionalProperties !== true
    )
      throw new Error('additionalProperties 只支持布尔值。');
    if (
      schema.required &&
      (!Array.isArray(schema.required) ||
        schema.required.some((key) => !Object.hasOwn(schema.properties || {}, key)))
    )
      throw new Error('required 必须引用已定义的 properties。');
    return Object.fromEntries(
      Object.entries(schema.properties || {}).map(([key, child]) => [
        key,
        build(child, path ? `${path}.${key}` : key, index, depth + 1),
      ]),
    );
  }
  if (type === 'array') {
    const [min, max] = bounds(
      schema.minItems,
      schema.maxItems,
      Math.min(1, schema.maxItems ?? 1),
      Math.max(1, schema.minItems || 0),
      true,
    );
    if (min < 0 || max > 50 || !record(schema.items))
      throw new Error('数组需提供 items，minItems/maxItems 范围为 0–50。');
    return Array.from({ length: min }, () => build(schema.items, `${path}[]`, index, depth + 1));
  }
  if (type === 'null') return null;
  if (type === 'boolean') return faker.datatype.boolean();
  if (type === 'integer' || type === 'number') {
    const [min, max] = bounds(
      schema.minimum,
      schema.maximum,
      Math.min(0, schema.maximum ?? 0),
      Math.max(1000, schema.minimum || 0),
      type === 'integer',
    );
    return type === 'integer' ? faker.number.int({ min, max }) : faker.number.float({ min, max });
  }
  if (type === 'string') {
    const [min, max] = bounds(
      schema.minLength,
      schema.maxLength,
      Math.min(8, schema.maxLength ?? 8),
      Math.max(20, schema.minLength || 0),
      true,
    );
    if (min < 0 || max > 1000) throw new Error('字符串长度范围为 0–1,000。');
    let result;
    switch (schema.format) {
      case undefined:
        result = faker.string.alpha({ length: min });
        break;
      case 'email':
        result = faker.internet.email();
        break;
      case 'uuid':
        result = faker.string.uuid();
        break;
      case 'date-time':
        result = date();
        break;
      case 'date':
        result = date().slice(0, 10);
        break;
      case 'uri':
        result = `https://example.com/${faker.string.alpha(8)}`;
        break;
      default:
        throw new Error(`不支持的 format：${schema.format}`);
    }
    if (
      (schema.minLength !== undefined && result.length < min) ||
      (schema.maxLength !== undefined && result.length > max)
    )
      throw new Error('format 与长度约束不兼容。');
    return result;
  }
  throw new Error(`${path || '$'} 需要明确且受支持的 type。`);
}

function referenceTarget(root, ref) {
  const match = typeof ref === 'string' && /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref);
  if (!match || !Object.hasOwn(root[match[1]] || {}, match[2]))
    throw new Error('仅支持已定义的本地 Schema 引用。');
  return root[match[1]][match[2]];
}

export function resolveSchemaObject(root, value) {
  const seen = new Set();
  while (value?.$ref !== undefined) {
    if (seen.has(value.$ref) || seen.size >= 20) throw new Error('Schema 引用循环或嵌套过深。');
    seen.add(value.$ref);
    value = referenceTarget(root, value.$ref);
  }
  return record(value) ? value : undefined;
}

function matchesFormat(value, format) {
  if (!format) return true;
  if (format === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === 'uuid') return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  if (format === 'uri') return URL.canParse(value);
  if (format === 'date')
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    );
  return (
    format === 'date-time' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export async function generateSchemaResponse(text, context = {}) {
  if (typeof text !== 'string' || text.length > 64000) throw new Error('响应 Schema 最多 64,000 字符。');
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('请填写有效的 JSON Schema。');
  }
  const { faker } = await import('@faker-js/faker/locale/zh_CN');
  let nodes = 0,
    size = 0;
  function build(value, path, index, depth) {
    if (++nodes > 5000 || depth > 20) throw new Error('Schema 生成超出 5,000 个节点或 20 层。');
    if (!record(value)) throw new Error('Schema 必须是对象。');
    const {
      $defs,
      definitions,
      $ref,
      example,
      readOnly,
      writeOnly,
      deprecated,
      'x-devkit-request': binding,
      ...schema
    } = value;
    if ($ref !== undefined) {
      if (Object.keys(schema).some((key) => !['title', 'description'].includes(key)))
        throw new Error('本地 Schema 引用不支持叠加生成约束。');
      const target = referenceTarget(root, $ref);
      return build(
        binding === undefined ? target : { ...target, 'x-devkit-request': binding },
        path,
        index,
        depth + 1,
      );
    }
    if (Array.isArray(schema.type) && schema.type.length === 2 && schema.type.includes('null'))
      schema.type = schema.type.find((type) => type !== 'null');
    let result = buildSchemaNode(schema, path, index, depth, build, faker, () =>
      faker.date.recent().toISOString(),
    );
    if (binding !== undefined) {
      const [prefix, source, ...parts] = typeof binding === 'string' ? binding.split('.') : [];
      const key = parts.join('.');
      if (prefix !== 'request' || !validField(source, key)) throw new Error('Schema 请求字段无效。');
      let incoming = requestValue(context, source, key);
      if (source === 'query' && Array.isArray(incoming)) incoming = incoming[0];
      if (incoming !== undefined) {
        if (typeof incoming === 'string' && ['number', 'integer'].includes(schema.type) && incoming.trim())
          incoming = Number(incoming);
        if (schema.type === 'boolean' && ['true', 'false'].includes(incoming)) incoming = incoming === 'true';
        if (
          !['string', 'integer', 'number', 'boolean'].includes(schema.type) ||
          typeof incoming !== (schema.type === 'integer' ? 'number' : schema.type) ||
          (typeof incoming === 'number' &&
            (!Number.isFinite(incoming) ||
              (schema.type === 'integer' && !Number.isSafeInteger(incoming)) ||
              incoming < schema.minimum ||
              incoming > schema.maximum)) ||
          (typeof incoming === 'string' &&
            (incoming.length < schema.minLength ||
              incoming.length > schema.maxLength ||
              !matchesFormat(incoming, schema.format))) ||
          (schema.enum && !schema.enum.includes(incoming)) ||
          (Object.hasOwn(schema, 'const') && incoming !== schema.const)
        )
          throw new Error(path + ' 的请求值与 Schema 不兼容。');
        result = incoming;
      }
    }
    if (Object.hasOwn(schema, 'const') || schema.enum || typeof result !== 'object' || result === null)
      size += JSON.stringify(result).length;
    else if (!Array.isArray(result)) size += Object.keys(result).reduce((sum, key) => sum + key.length + 4, 0);
    if (size > 512000) throw new Error('Schema 响应超过大小限制。');
    return result;
  }
  return build(root, '', 0, 0);
}
