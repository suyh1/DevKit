// Only a whole JSON string can be a placeholder. Object keys and other literals stay as written.
const fields = {
  uuid: faker => faker.string.uuid(),
  index: (_faker, index) => index + 1,
  name: faker => faker.person.fullName(),
  email: faker => faker.internet.exampleEmail(),
  phone: faker => faker.phone.number(),
  city: faker => faker.location.city(),
  product: faker => faker.commerce.productName(),
  price: faker => Number(faker.commerce.price({ min: 1, max: 2000 })),
  quantity: faker => faker.number.int({ min: 1, max: 20 }),
  boolean: faker => faker.datatype.boolean(),
  datetime: faker => faker.date.recent({ days: 30 }).toISOString(),
};
export const mockFieldNames = Object.keys(fields);

export function prepareMockResponse(body, count) {
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('列表条数须为 1 至 100 的整数。');
  if (typeof body !== 'string' || body.length > 64000) throw new Error('模板最多 64,000 字符。');
  let template;
  try { template = JSON.parse(body); }
  catch { throw new Error('请填写有效的 JSON 模板，占位符需用双引号包住。'); }
  let nodes = 0, characters = 0;
  function budget(copies, size) {
    characters += copies * size;
    if (characters > 512000) throw new Error('生成的响应过大，请缩短模板或减少列表条数。');
  }
  function compile(value, depth, copies) {
    nodes += copies;
    if (depth > 20 || nodes > 5000) throw new Error('生成的响应最多 20 层、5,000 个节点。');
    if (Array.isArray(value)) {
      if ((depth === 0 || (depth === 1 && !Array.isArray(template))) && value.length === 1) {
        const item = compile(value[0], depth + 1, copies * count);
        return faker => Array.from({ length: count }, (_, i) => item(faker, i));
      }
      const children = value.map(child => compile(child, depth + 1, copies));
      return faker => children.map((child, i) => child(faker, i));
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value).map(([key, child]) => {
        budget(copies, JSON.stringify(key).length + 2);
        return [key, compile(child, depth + 1, copies)];
      });
      return (faker, i) => Object.fromEntries(entries.map(([key, child]) => [key, child(faker, i)]));
    }
    const token = typeof value === 'string' && /^\{\{([^{}]*)\}\}$/.exec(value);
    if (token) {
      const name = token[1].trim();
      if (!Object.hasOwn(fields, name)) throw new Error('未知生成字段：' + name);
      budget(copies, 100);
      return fields[name];
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('模板数字超出范围。');
    budget(copies, JSON.stringify(value).length + 1);
    return () => value;
  }
  const render = compile(template, 0, 1);
  return async () => {
    const { faker } = await import('@faker-js/faker/locale/zh_CN');
    return render(faker, 0);
  };
}
