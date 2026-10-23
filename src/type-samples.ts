import type * as t from '@babel/types';
import type { CstNode, IToken } from 'java-parser';
import type { Options } from './tools';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Shape = { kind: 'primitive'; name: string } | { kind: 'literal'; value: Json }
  | { kind: 'array'; item: Shape } | { kind: 'tuple' | 'union' | 'intersection'; items: Shape[] }
  | { kind: 'object'; fields: Field[] } | { kind: 'ref'; name: string; args: Shape[]; scope?: string };
type Field = { name: string; shape: Shape; optional?: boolean };
type Definition = { name: string; params: { name: string; fallback?: Shape }[]; shape: Shape };
const primitive = (name: string): Shape => ({ kind: 'primitive', name });
const ref = (name: string, args: Shape[] = [], scope?: string): Shape => ({ kind: 'ref', name, args, scope });
const object = (fields: Field[]): Shape => ({ kind: 'object', fields });
const literal = (value: Json): Shape => ({ kind: 'literal', value });
const timestamp = '2026-01-01T00:00:00.000Z';
const unsupported = (message: string): never => { throw new Error(`${message}。请提供具体字段类型或简化类型定义。`); };

function tsName(node: t.Node): string {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'TSQualifiedName') return `${tsName(node.left)}.${tsName(node.right)}`;
  return unsupported('不支持动态类型名');
}
function tsLiteral(node: t.Node): Json {
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
    if (typeof node.value === 'number' && !Number.isFinite(node.value)) return unsupported('JSON 不支持非有限数字');
    return node.value;
  }
  if (node.type === 'NullLiteral') return null;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral') return -node.argument.value;
  return unsupported('不支持此字面量或枚举初始化表达式');
}
function tsShape(node: t.TSType, depth = 0): Shape {
  if (depth > 60) throw new Error('类型嵌套超过 60 层。');
  const next = (value: t.TSType) => tsShape(value, depth + 1);
  switch (node.type) {
    case 'TSStringKeyword': return primitive('string');
    case 'TSNumberKeyword': return primitive('number');
    case 'TSBooleanKeyword': return primitive('boolean');
    case 'TSNullKeyword': case 'TSUndefinedKeyword': case 'TSVoidKeyword': case 'TSAnyKeyword': case 'TSUnknownKeyword': return literal(null);
    case 'TSObjectKeyword': return object([]);
    case 'TSBigIntKeyword': return literal('0');
    case 'TSLiteralType': return literal(tsLiteral(node.literal));
    case 'TSArrayType': return { kind: 'array', item: next(node.elementType) };
    case 'TSTupleType': return { kind: 'tuple', items: node.elementTypes.map(item => next(item.type === 'TSNamedTupleMember' ? item.elementType : item)) };
    case 'TSOptionalType': return next(node.typeAnnotation);
    case 'TSParenthesizedType': return next(node.typeAnnotation);
    case 'TSUnionType': return { kind: 'union', items: node.types.map(next) };
    case 'TSIntersectionType': return { kind: 'intersection', items: node.types.map(next) };
    case 'TSTypeReference': return ref(tsName(node.typeName), node.typeArguments?.params.map(next));
    case 'TSTypeLiteral': return tsFields(node.members, depth + 1);
    case 'TSTypeOperator': if (node.operator === 'readonly') return next(node.typeAnnotation); break;
  }
  return unsupported(`暂不支持 TypeScript ${node.type}（如条件类型、映射类型、keyof 或函数类型）`);
}
function tsFields(members: t.TSTypeElement[], depth = 0): Shape {
  const fields: Field[] = [];
  for (const member of members) {
    if (member.type === 'TSMethodSignature' || member.type === 'TSCallSignatureDeclaration' || member.type === 'TSConstructSignatureDeclaration') continue;
    if (member.type === 'TSIndexSignature') {
      if (member.parameters.length !== 1 || !member.typeAnnotation) return unsupported('索引签名缺少类型');
      fields.push({ name: 'key', shape: tsShape(member.typeAnnotation.typeAnnotation, depth + 1) }); continue;
    }
    if (member.type !== 'TSPropertySignature' || member.computed || !member.typeAnnotation) return unsupported('字段需要静态字段名与显式类型');
    const name = member.key.type === 'Identifier' ? member.key.name : member.key.type === 'StringLiteral' || member.key.type === 'NumericLiteral' ? String(member.key.value) : unsupported('不支持此字段名');
    fields.push({ name, shape: tsShape(member.typeAnnotation.typeAnnotation, depth + 1), optional: !!member.optional });
  }
  return object(fields);
}
async function parseTypescript(input: string): Promise<Map<string, Definition>> {
  const { parse } = await import('@babel/parser');
  const ast = parse(input, { sourceType: 'module', plugins: ['typescript'], attachComment: false });
  const definitions = new Map<string, Definition>();
  for (const statement of ast.program.body) {
    const node = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
    if (!node || !['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'].includes(node.type)) continue;
    if (node.type === 'TSEnumDeclaration') {
      let index = 0;
      const values = node.body.members.map(member => {
        const value = member.initializer ? tsLiteral(member.initializer) : index;
        index = typeof value === 'number' ? value + 1 : 0;
        return literal(value);
      });
      if (!values.length) return unsupported('空枚举没有可生成的值');
      if (definitions.has(node.id.name)) return unsupported(`重复类型 ${node.id.name}`);
      definitions.set(node.id.name, { name: node.id.name, params: [], shape: { kind: 'union', items: values } });
    } else if (node.type === 'TSInterfaceDeclaration' || node.type === 'TSTypeAliasDeclaration') {
      if (definitions.has(node.id.name)) return unsupported(`重复类型 ${node.id.name}`);
      const params = node.typeParameters?.params.map(param => ({ name: param.name.name, fallback: param.default ? tsShape(param.default) : undefined })) ?? [];
      const shape = node.type === 'TSTypeAliasDeclaration' ? tsShape(node.typeAnnotation) : {
        kind: 'intersection' as const, items: [...(node.extends ?? []).map(parent => ref(tsName(parent.expression), parent.typeArguments?.params.map(item => tsShape(item)))), tsFields(node.body.body)],
      };
      definitions.set(node.id.name, { name: node.id.name, params, shape });
    }
    if (definitions.size > 500) throw new Error('最多支持 500 个类型定义。');
  }
  return definitions;
}

// Java syntax is validated by java-parser. This small grammar only interprets
// declared field types; initializers, method bodies and annotations never run.
function javaType(input: string, scope: string): Shape {
  const tokens = input.match(/[\p{L}_$][\p{L}\p{N}_$]*|\.\.\.|[^\s]/gu) ?? [];
  let position = 0;
  function parse(depth = 0): Shape {
    if (depth > 60) throw new Error('Java 类型嵌套超过 60 层。');
    if (tokens[position] === '?') {
      position++;
      if (['extends', 'super'].includes(tokens[position])) { position++; return parse(depth + 1); }
      return literal(null);
    }
    let name = tokens[position++];
    if (!name || !/^[\p{L}_$]/u.test(name)) return unsupported(`不支持 Java 类型 ${input}`);
    while (tokens[position] === '.') { position++; name += '.' + tokens[position++]; }
    const args: Shape[] = [];
    if (tokens[position] === '<') {
      position++;
      do { args.push(parse(depth + 1)); if (tokens[position] !== ',') break; position++; } while (position < tokens.length);
      if (tokens[position++] !== '>') return unsupported(`Java 泛型不完整 ${input}`);
    }
    let shape: Shape = ref(name, args, scope);
    while (tokens[position] === '[' || tokens[position] === '...') {
      if (tokens[position++] === '[' && tokens[position++] !== ']') return unsupported('Java 数组类型无效');
      shape = { kind: 'array', item: shape };
    }
    return shape;
  }
  const shape = parse();
  if (position !== tokens.length) return unsupported(`暂不支持带类型注解等复杂 Java 类型 ${input}`);
  return shape;
}
async function parseJava(input: string): Promise<Map<string, Definition>> {
  const { lexAndParse } = await import('java-parser');
  const { cst, tokens } = lexAndParse(input);
  const definitions = new Map<string, Definition>();
  const nodes = (node: CstNode, key?: string): CstNode[] => (key ? node.children[key] ?? [] : Object.values(node.children).flat()).filter(child => 'name' in child) as CstNode[];
  const first = (node: CstNode, key: string): CstNode => { const result = nodes(node, key)[0]; if (!result) throw new Error(`Java 结构缺少 ${key}`); return result; };
  const text = (node: CstNode) => tokens.filter(token => token.startOffset >= node.location.startOffset && token.endOffset <= node.location.endOffset).map(token => token.image).join(' ');
  const compact = (node: CstNode) => text(node).replace(/\s+/g, '');
  const identifier = (node: CstNode): string => (node.children.Identifier?.[0] as IToken | undefined)?.image ?? unsupported('Java 缺少字段或类型名称');
  const declarationNames = ['normalClassDeclaration', 'recordDeclaration', 'enumDeclaration'];
  const find = (node: CstNode, name: string): CstNode[] => node.name === name ? [node] : nodes(node).flatMap(child => declarationNames.includes(child.name) ? [] : find(child, name));
  function collect(node: CstNode, parent = '') {
    if (!declarationNames.includes(node.name)) { for (const child of nodes(node)) collect(child, parent); return; }
    const shortName = identifier(first(node, 'typeIdentifier')), name = parent ? `${parent}.${shortName}` : shortName;
    if (definitions.has(name)) return unsupported(`重复 Java 类型 ${name}`);
    const fields: Field[] = [];
    const params = nodes(node, 'typeParameters').flatMap(parameter => find(parameter, 'typeParameter')).map(parameter => ({ name: identifier(first(parameter, 'typeIdentifier')) }));
    const shape = node.name === 'enumDeclaration' ? { kind: 'union' as const, items: find(node, 'enumConstant').map(item => literal(identifier(item))) } : object(fields);
    definitions.set(name, { name, params, shape });
    if (definitions.size > 500) throw new Error('最多支持 500 个 Java 类型。');
    function field(node: CstNode, record: boolean) {
      const modifierNodes = nodes(node, record ? 'recordComponentModifier' : 'fieldModifier');
      const modifiers = modifierNodes.map(text).join(' ');
      if (modifierNodes.some(item => item.children.Static || item.children.Transient) || /@\s*(?:[\w$.]+\.)?JsonIgnore\b(?!\s*\(\s*false\s*\))/.test(modifiers)) return;
      const annotation = /@\s*(?:[\w$.]+\.)?JsonProperty\s*\(\s*(?:value\s*=\s*)?("(?:\\.|[^"\\])*")/.exec(modifiers);
      const mappedName = annotation ? JSON.parse(annotation[1]) as string : undefined;
      const type = javaType(text(first(node, 'unannType')), name);
      const varargs = record ? nodes(node, 'variableArityRecordComponent')[0] : undefined;
      if (record) fields.push({ name: mappedName ?? identifier(varargs ?? node), shape: varargs ? { kind: 'array', item: type } : type });
      else for (const variable of find(first(node, 'variableDeclaratorList'), 'variableDeclarator')) {
        const id = first(variable, 'variableDeclaratorId');
        let fieldType = type;
        for (let index = 0; index < nodes(id, 'dims').reduce((count, dims) => count + (compact(dims).match(/\[/g)?.length ?? 0), 0); index++) fieldType = { kind: 'array', item: fieldType };
        fields.push({ name: mappedName ?? identifier(id), shape: fieldType });
      }
    }
    function members(current: CstNode) {
      if (declarationNames.includes(current.name)) { collect(current, name); return; }
      // java-parser 3 class-member lookahead can classify a nested record as
      // a method returning "record". Reparse that declaration at top level,
      // then restore source offsets so normal field extraction remains exact.
      if (current.name === 'methodDeclaration') {
        const header = nodes(current, 'methodHeader')[0];
        const result = header && nodes(header, 'result')[0];
        if (result && compact(result) === 'record') {
          const start = current.location.startOffset;
          const nested = lexAndParse(input.slice(start, current.location.endOffset + 1)).cst;
          const shift = (node: CstNode) => { node.location.startOffset += start; node.location.endOffset += start; for (const child of nodes(node)) shift(child); };
          shift(nested); collect(nested, name); return;
        }
      }
      if (['methodDeclaration', 'constructorDeclaration', 'compactConstructorDeclaration', 'variableInitializer', 'instanceInitializer', 'staticInitializer'].includes(current.name)) return;
      if (current.name === 'fieldDeclaration') { field(current, false); return; }
      if (current.name === 'recordComponent') { field(current, true); return; }
      for (const child of nodes(current)) members(child);
    }
    for (const child of nodes(node)) members(child);
    const parentType = nodes(node, 'classExtends')[0];
    if (parentType && compact(first(parentType, 'classType')) !== 'Object') definitions.get(name)!.shape = { kind: 'intersection', items: [javaType(text(first(parentType, 'classType')), parent), shape] };
  }
  collect(cst);
  return definitions;
}

function generate(definitions: Map<string, Definition>, options: Options): Json {
  const arrayLength = Number(options.arrayLength ?? 1);
  if (!Number.isInteger(arrayLength) || arrayLength < 0 || arrayLength > 5) throw new Error('数组示例数量需为 0–5 的整数。');
  const root = options.rootName?.trim() || definitions.keys().next().value;
  if (!root || !definitions.has(root)) throw new Error(`未找到根类型 ${root ?? ''}；可用类型：${[...definitions.keys()].join('、') || '无'}。`);
  let budget = 10_000;
  function resolve(name: string, scope = ''): Definition | undefined {
    for (let current = scope; current; current = current.includes('.') ? current.slice(0, current.lastIndexOf('.')) : '') {
      const result = definitions.get(`${current}.${name}`); if (result) return result;
    }
    return definitions.get(name);
  }
  const isObject = (value: Json): value is Record<string, Json> => !!value && typeof value === 'object' && !Array.isArray(value);
  function value(shape: Shape, env = new Map<string, Shape>(), stack: string[] = [], depth = 0): Json {
    if (--budget < 0 || depth > 60) throw new Error('示例超过 10,000 节点或 60 层，请减少数组数量或简化定义。');
    const next = (child: Shape) => value(child, env, stack, depth + 1);
    switch (shape.kind) {
      case 'literal': return shape.value;
      case 'primitive': return shape.name === 'string' ? '' : shape.name === 'boolean' ? false : 0;
      case 'array': return Array.from({ length: arrayLength }, () => next(shape.item));
      case 'tuple': return shape.items.map(next);
      case 'union': return shape.items.length ? next(shape.items.find(item => item.kind !== 'literal' || item.value !== null) ?? shape.items[0]) : null;
      case 'intersection': {
        const result: Record<string, Json> = Object.create(null);
        for (const item of shape.items) { const part = next(item); if (!isObject(part)) return unsupported('交叉类型或继承必须展开为对象，且不能循环继承'); Object.assign(result, part); }
        return result;
      }
      case 'object': {
        const result: Record<string, Json> = Object.create(null);
        for (const field of shape.fields) {
          if (field.optional && options.optional === 'exclude') continue;
          if (Object.hasOwn(result, field.name)) return unsupported(`字段映射重复 ${field.name}`);
          result[field.name] = next(field.shape);
        }
        return result;
      }
      case 'ref': {
        const bound = env.get(shape.name);
        if (bound) return next(bound);
        const definition = resolve(shape.name, shape.scope);
        if (definition) {
          if (stack.includes(definition.name)) return null;
          if (shape.args.length > definition.params.length) return unsupported(`泛型参数过多 ${shape.name}`);
          const environment = new Map<string, Shape>();
          const substitute = (item: Shape, steps = 0): Shape => {
            if (steps > 60) throw new Error('泛型替换嵌套超过 60 层。');
            const sub = (child: Shape) => substitute(child, steps + 1);
            if (item.kind === 'ref') return env.has(item.name) ? sub(env.get(item.name)!) : { ...item, args: item.args.map(sub) };
            if (item.kind === 'array') return { ...item, item: sub(item.item) };
            if (item.kind === 'object') return { ...item, fields: item.fields.map(field => ({ ...field, shape: sub(field.shape) })) };
            if (item.kind === 'tuple' || item.kind === 'union' || item.kind === 'intersection') return { ...item, items: item.items.map(sub) };
            return item;
          };
          definition.params.forEach((param, index) => {
            const argument = shape.args[index] ?? param.fallback;
            if (!argument) return unsupported(`泛型参数 ${param.name} 未指定（根类型需使用带具体参数的别名）`);
            environment.set(param.name, substitute(argument));
          });
          return value(definition.shape, environment, [...stack, definition.name], depth + 1);
        }
        const name = shape.name.split('.').pop()!;
        if (['String', 'CharSequence', 'string', 'char', 'Character', 'UUID'].includes(name)) return '';
        if (['boolean', 'Boolean'].includes(name)) return false;
        if (['byte', 'short', 'int', 'long', 'float', 'double', 'Byte', 'Short', 'Integer', 'Long', 'Float', 'Double', 'BigInteger', 'BigDecimal', 'Number'].includes(name)) return 0;
        if (['Date', 'Instant', 'OffsetDateTime', 'ZonedDateTime', 'Timestamp'].includes(name)) return timestamp;
        if (name === 'LocalDateTime') return '2026-01-01T00:00:00';
        if (name === 'LocalDate') return '2026-01-01';
        if (name === 'LocalTime') return '00:00:00';
        if (['Object', 'Void'].includes(name)) return null;
        if (['Array', 'ReadonlyArray', 'List', 'Set', 'Collection', 'Iterable', 'ArrayList', 'LinkedList', 'HashSet'].includes(name)) {
          if (shape.args.length !== 1) return unsupported(`${name} 需要一个元素类型`);
          return Array.from({ length: arrayLength }, () => next(shape.args[0]));
        }
        if (['Map', 'HashMap', 'LinkedHashMap', 'Record'].includes(name)) {
          if (shape.args.length !== 2) return unsupported(`${name} 需要键和值两个类型`);
          const keys = shape.args[0].kind === 'union' ? shape.args[0].items : [shape.args[0]];
          return Object.fromEntries(keys.map(keyShape => {
            const key = next(keyShape);
            if (typeof key !== 'string' && typeof key !== 'number') return unsupported('Map / Record 的键需为字符串或数字类型');
            return [String(key === '' && keyShape.kind !== 'literal' ? 'key' : key), next(shape.args[1])];
          }));
        }
        if (['Optional', 'Readonly', 'Required'].includes(name) && shape.args.length === 1) return next(shape.args[0]);
        return unsupported(`无法解析类型 ${shape.name}；请同时粘贴引用的定义`);
      }
    }
  }
  return value(ref(root));
}

export async function typesToJson(input: string, options: Options): Promise<string> {
  if (!input.trim()) throw new Error('请粘贴 Java 类 / Record 或 TypeScript interface / type 定义。');
  if (input.length > 200_000) throw new Error('类型定义最多支持 200,000 字符。');
  if (!['java', 'ts'].includes(options.language || 'ts')) throw new Error('请选择 Java 或 TypeScript。');
  const definitions = options.language === 'java' ? await parseJava(input) : await parseTypescript(input);
  return JSON.stringify(generate(definitions, options), null, 2);
}
