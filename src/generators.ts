type PrimitiveKind = 'string' | 'boolean' | 'integer' | 'long' | 'bigint' | 'decimal' | 'null' | 'unknown';
type Property = { schema: Schema; optional: boolean };
type ObjectSchema = { kind: 'object'; properties: Map<string, Property> };
type Schema = { kind: PrimitiveKind } | ObjectSchema | { kind: 'array'; item: Schema } | { kind: 'union'; variants: Schema[] };
const numeric = ['integer', 'long', 'bigint', 'decimal'];
const javaReserved = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _ record var yield sealed permits non-sealed').split(' '));
const tsReserved = new Set(('any boolean break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in infer instanceof interface keyof let module namespace never new null number object package private protected public readonly return static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield await constructor').split(' '));

function merge(a: Schema, b: Schema): Schema {
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;
  if (a.kind === 'object' && b.kind === 'object') {
    const properties = new Map<string, Property>();
    for (const key of new Set([...a.properties.keys(), ...b.properties.keys()])) {
      const left = a.properties.get(key), right = b.properties.get(key);
      properties.set(key, left && right ? { schema: merge(left.schema, right.schema), optional: left.optional || right.optional } : { schema: (left || right)!.schema, optional: true });
    }
    return { kind: 'object', properties };
  }
  if (a.kind === 'array' && b.kind === 'array') return { kind: 'array', item: merge(a.item, b.item) };
  if (numeric.includes(a.kind) && numeric.includes(b.kind)) return { kind: numeric[Math.max(numeric.indexOf(a.kind), numeric.indexOf(b.kind))] as PrimitiveKind };
  if (a.kind === b.kind && a.kind !== 'union') return a;
  const variants: Schema[] = [];
  for (const item of [...(a.kind === 'union' ? a.variants : [a]), ...(b.kind === 'union' ? b.variants : [b])]) {
    const index = variants.findIndex(old => old.kind === item.kind || (numeric.includes(old.kind) && numeric.includes(item.kind)));
    if (index < 0) variants.push(item); else variants[index] = merge(variants[index], item);
  }
  return variants.length === 1 ? variants[0] : { kind: 'union', variants };
}

// Native JSON.parse validates grammar. This second token pass infers number ranges
// from their original spelling, without converting large integers to JS Number.
function infer(input: string): Schema {
  JSON.parse(input);
  const tokens = input.match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g) || [];
  let cursor = 0;
  function value(depth = 0): Schema {
    if (depth > 100) throw new Error('JSON 嵌套超过 100 层。');
    const token = tokens[cursor++];
    if (token === '{') {
      const properties = new Map<string, Property>();
      while (tokens[cursor] !== '}') {
        const key: string = JSON.parse(tokens[cursor++]);
        cursor++; // colon
        properties.set(key, { schema: value(depth + 1), optional: false });
        if (tokens[cursor] !== ',') break;
        cursor++;
      }
      cursor++;
      return { kind: 'object', properties };
    }
    if (token === '[') {
      let item: Schema = { kind: 'unknown' };
      while (tokens[cursor] !== ']') {
        item = merge(item, value(depth + 1));
        if (tokens[cursor] !== ',') break;
        cursor++;
      }
      cursor++;
      return { kind: 'array', item };
    }
    if (token[0] === '"') return { kind: 'string' };
    if (token === 'null') return { kind: 'null' };
    if (token === 'true' || token === 'false') return { kind: 'boolean' };
    if (/[.eE]/.test(token)) return { kind: 'decimal' };
    const integer = BigInt(token);
    return { kind: integer >= -2147483648n && integer <= 2147483647n ? 'integer' : integer >= -9223372036854775808n && integer <= 9223372036854775807n ? 'long' : 'bigint' };
  }
  return value();
}

function rootName(input: string | undefined, language: 'java' | 'ts'): string {
  const name = input?.trim() || 'Root';
  const forbidden = language === 'java' ? javaReserved : tsReserved;
  if (!/^[A-Za-z_$][A-Za-z\d_$]*$/.test(name) || forbidden.has(name)) throw new Error('根类型名需为有效标识符，例如 User 或 ApiResponse，且不能使用保留字。');
  if ((language === 'java' ? ['String', 'Integer', 'Long', 'Boolean', 'Object', 'List', 'BigInteger', 'BigDecimal'] : ['Array']).includes(name)) throw new Error('根类型名与内置类型冲突，请使用 User、Root 等名称。');
  return name;
}
function pascal(key: string): string {
  const words = key.match(/[A-Za-z\d$]+/g) || ['Field'];
  let name = words.map(word => word[0].toUpperCase() + word.slice(1)).join('');
  if (/^\d/.test(name)) name = 'Field' + name;
  return name;
}
function claimName(hint: string, used: Set<string>): string {
  let name = hint;
  for (let index = 2; used.has(name); index++) name = hint + index;
  used.add(name);
  return name;
}
function javaField(key: string, used: Set<string>): string {
  const name = pascal(key);
  let field = name[0].toLowerCase() + name.slice(1);
  if (javaReserved.has(field)) field += 'Value';
  return claimName(field, used);
}
function javaString(text: string): string {
  // ASCII escapes also keep comment delimiters and Java's pre-lexical Unicode
  // escape processing out of generated annotations and comments.
  return JSON.stringify(text).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function jsonToJava(input: string, options: Record<string, string>): string {
  const root = rootName(options.rootName, 'java');
  let schema = infer(input);
  const arrayRoot = schema.kind === 'array';
  if (schema.kind === 'array') schema = schema.item;
  if (schema.kind === 'union') {
    const variants = schema.variants.filter(item => item.kind !== 'null');
    if (variants.length === 1) schema = variants[0];
  }
  if (schema.kind !== 'object') throw new Error('Java 转换需要 JSON 对象，或至少包含一个对象的对象数组。');
  const record = options.style === 'record';
  const jackson = options.annotations === 'jackson';
  const imports = new Set<string>();
  const used = new Set([root, 'String', 'Integer', 'Long', 'Boolean', 'Object', 'List', 'BigInteger', 'BigDecimal']);
  const definitions: { name: string; schema: ObjectSchema }[] = [{ name: root, schema }];
  function type(node: Schema, hint: string): string {
    if (node.kind === 'union') {
      const withoutNull = node.variants.filter(item => item.kind !== 'null');
      return withoutNull.length === 1 ? type(withoutNull[0], hint) : 'Object';
    }
    if (node.kind === 'array') { imports.add('java.util.List'); return `List<${type(node.item, hint + 'Item')}>`; }
    if (node.kind === 'object') {
      const name = claimName(pascal(hint), used);
      definitions.push({ name, schema: node });
      return name;
    }
    if (node.kind === 'bigint') { imports.add('java.math.BigInteger'); return 'BigInteger'; }
    if (node.kind === 'decimal') { imports.add('java.math.BigDecimal'); return 'BigDecimal'; }
    return { string: 'String', boolean: 'Boolean', integer: 'Integer', long: 'Long', null: 'Object', unknown: 'Object' }[node.kind];
  }
  const bodies: string[] = [];
  for (let index = 0; index < definitions.length; index++) {
    if (definitions.length > 500) throw new Error('生成类型超过 500 个，请缩小样本。');
    const definition = definitions[index];
    const fieldsUsed = new Set<string>();
    const fields = [...definition.schema.properties].map(([key, property]) => {
      let name = javaField(key, fieldsUsed);
      if (record && ['clone', 'finalize', 'getClass', 'hashCode', 'notify', 'notifyAll', 'toString', 'wait'].includes(name)) name = claimName(name + 'Value', fieldsUsed);
      return { key, property, name, type: type(property.schema, pascal(key)) };
    });
    const mapping = (field: typeof fields[number]) => {
      const lines: string[] = [];
      if (field.property.optional) lines.push('// 此字段未出现在所有样本中');
      if (field.key !== field.name && !jackson) {
        const safeKey = field.key.replace(/\\/g, '[反斜杠]').replace(/[\r\n\u2028\u2029]/g, '[换行]');
        lines.push(`// 原始 JSON 键: ${safeKey}；启用 Jackson 注解可保留映射`);
      }
      if (jackson) { imports.add('com.fasterxml.jackson.annotation.JsonProperty'); lines.push(`@JsonProperty(${javaString(field.key)})`); }
      return lines;
    };
    if (record) {
      const params = fields.map(field => [...mapping(field), `${field.type} ${field.name}`].map(line => '    ' + line).join('\n')).join(',\n');
      bodies.push(`public record ${definition.name}(${params ? '\n' + params + '\n' : ''}) {}`);
    } else {
      const declarations = fields.map(field => [...mapping(field), `private ${field.type} ${field.name};`].map(line => '    ' + line).join('\n')).join('\n\n');
      const accessors = fields.map(field => {
        const suffix = field.name[0].toUpperCase() + field.name.slice(1);
        return `    public ${field.type} get${suffix}() {\n        return ${field.name};\n    }\n\n    public void set${suffix}(${field.type} ${field.name}) {\n        this.${field.name} = ${field.name};\n    }`;
      }).join('\n\n');
      bodies.push(`public class ${definition.name} {${fields.length ? '\n' + declarations + '\n\n' + accessors + '\n' : ''}}`);
    }
  }
  // Keep the output compilable as a single Root.java file using nested definitions.
  let body = bodies[0];
  if (bodies.length > 1) {
    const nested = bodies.slice(1).map(item => (record ? item : item.replace('public class ', 'public static class ')).split('\n').map(line => line ? '    ' + line : '').join('\n')).join('\n\n');
    body = body.slice(0, -1) + '\n' + nested + '\n}';
  }
  const header = [`// 根据 JSON 样本推断；null / 空数组使用 Object，混合类型使用 Object。`, `// 保存为 ${root}.java${record ? '；需要 Java 16+' : '；使用包装类型以支持 null'}`];
  if (arrayRoot) header.push(`// JSON 根类型：java.util.List<${root}>`);
  if (jackson) header.push('// 字段映射需要 jackson-annotations；Record 绑定需要支持 Record 的 Jackson 版本。');
  return header.join('\n') + '\n\n' + [...imports].sort().map(name => `import ${name};`).join('\n') + (imports.size ? '\n\n' : '') + body + '\n';
}

export function jsonToTypescript(input: string, options: Record<string, string>, literal: string): string {
  const root = rootName(options.rootName, 'ts');
  const used = new Set([root, 'Array']);
  const definitions: { name: string; schema: Schema }[] = [{ name: root, schema: infer(input) }];
  function type(node: Schema, hint: string): string {
    if (node.kind === 'object') {
      const name = claimName(pascal(hint), used);
      definitions.push({ name, schema: node });
      return name;
    }
    if (node.kind === 'array') return `Array<${type(node.item, hint + 'Item')}>`;
    if (node.kind === 'union') return [...new Set(node.variants.map(item => type(item, hint)))].join(' | ');
    if (numeric.includes(node.kind)) return 'number';
    return node.kind;
  }
  const bodies: string[] = [];
  for (let index = 0; index < definitions.length; index++) {
    if (definitions.length > 500) throw new Error('生成类型超过 500 个，请缩小样本。');
    const definition = definitions[index];
    if (definition.schema.kind !== 'object') { bodies.push(`export type ${definition.name} = ${type(definition.schema, definition.name)};`); continue; }
    const fields = [...definition.schema.properties].map(([key, property]) => `  ${/^[A-Za-z_$][A-Za-z\d_$]*$/.test(key) ? key : JSON.stringify(key)}${property.optional ? '?' : ''}: ${type(property.schema, pascal(key))};`).join('\n');
    bodies.push(options.style === 'type' ? `export type ${definition.name} = {\n${fields}\n};` : `export interface ${definition.name} {\n${fields}\n}`);
  }
  let output = '// 根据 JSON 样本推断；未出现的字段为可选，空数组为 unknown[]。\n// number 使用 JavaScript 数值精度；样本无法代表完整业务 Schema。\n\n' + bodies.join('\n\n') + '\n';
  if (options.value === 'include') {
    // A computed property prevents __proto__ in an object literal changing its prototype.
    const safeLiteral = literal.replace(/^(\s*)"__proto__":/gm, '$1["__proto__"]:');
    const variable = root === 'data' ? 'sampleData' : 'data';
    output += `\nexport const ${variable}: ${root} = ${safeLiteral};\n`;
  }
  return output;
}
