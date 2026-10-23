import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { transform, tools, defaultOptions } from './tools';
import type { Options } from './tools';
import { normalizeFavorites, importWorkspace, validatePreferences } from './workbench';
import { developerPresentation } from './tool-presentation';

const reverse = async (input: string, options: Options = {}) => JSON.parse(await transform('type-json', input, { ...defaultOptions['type-json'], ...options }));
describe('unified JSON / type tools', () => {
  it('has one forward entry and one reverse entry, alongside the extended tool catalog', () => {
    expect(tools).toHaveLength(44);
    expect(tools.filter(tool => ['json-java', 'json-ts'].includes(tool.id))).toEqual([]);
    expect(tools.some(tool => tool.id === 'json-code')).toBe(true);
    expect(tools.some(tool => tool.id === 'type-json')).toBe(true);
  });
  it('retains all Java and TS generator options and correct export languages', async () => {
    const input = '{"user_name":"Alice","profile":{"active":true}}';
    const options = { ...defaultOptions['json-code'], rootName: 'User', javaStyle: 'record', tsStyle: 'type', annotations: 'jackson', value: 'none' };
    const java = await transform('json-code', input, { ...options, language: 'java' });
    expect(java).toContain('public record User('); expect(java).toContain('@JsonProperty("user_name")');
    const typescript = await transform('json-code', input, { ...options, language: 'ts' });
    expect(typescript).toContain('export type User'); expect(typescript).not.toContain('export const');
    expect(developerPresentation('json-code', { language: 'java' })).toMatchObject({ input: 'json', output: 'java', extension: 'java' });
    expect(developerPresentation('json-code', { language: 'ts' })?.extension).toBe('ts');
    expect(developerPresentation('type-json', { language: 'java' })).toMatchObject({ input: 'java', output: 'json', extension: 'json', preview: true });
  });
  it('migrates old workspaces without losing language, style or results', () => {
    const snapshot = JSON.stringify({ format: 'devkit-workspace', version: 1, active: 1, tasks: [
      { toolId: 'json-java', input: '{}', output: 'java', options: { rootName: 'User', style: 'record', annotations: 'jackson', language: 'ts' } },
      { toolId: 'json-ts', input: '{}', output: 'ts', options: { rootName: 'Model', style: 'type', value: 'none' } },
    ] });
    const result = importWorkspace(snapshot);
    expect(result.active).toBe(1);
    expect(result.tasks[0]).toMatchObject({ toolId: 'json-code', output: 'java', status: 'stale', options: { rootName: 'User', language: 'java', javaStyle: 'record', annotations: 'jackson' } });
    expect(result.tasks[1].options).toMatchObject({ rootName: 'Model', language: 'ts', tsStyle: 'type', value: 'none' });
    expect(normalizeFavorites(['json-java', 'json-ts', 'json', 'missing'])).toEqual(['json-code', 'json']);
    expect(validatePreferences({ startup: 'json-java' }).startup).toBe('json-code');
  });
  it('generates TS primitive, nested, optional, array, tuple and quoted-key samples', async () => {
    const input = 'export interface User {id:number;name:string;active:boolean;profile:{city:string};tags:string[];note?:string;pair:[label:string,count:number];"a.b":null;anything:unknown}';
    const output = await reverse(input);
    expect(output).toEqual({ id: 0, name: '', active: false, profile: { city: '' }, tags: [''], note: '', pair: ['', 0], 'a.b': null, anything: null });
    expect(await reverse(input, { optional: 'exclude', arrayLength: '0' })).toEqual({ id: 0, name: '', active: false, profile: { city: '' }, tags: [], pair: ['', 0], 'a.b': null, anything: null });
  });
  it('combines TS local aliases, unions, literals, inheritance and intersection', async () => {
    const input = 'interface Base {id:number} interface User extends Base {role:Role;address:Address;kind:"user"|null;score:-1} type Address={city:string};enum Role {Admin="admin",User="user"} type Result=User & {ok:true}';
    expect(await reverse(input, { rootName: 'Result' })).toEqual({ id: 0, role: 'admin', address: { city: '' }, kind: 'user', score: -1, ok: true });
  });
  it('resolves TS generic defaults, concrete aliases and nested generic arguments', async () => {
    const input = 'type Response<T>={data:T;items:Array<T>}; type User={name:string}; type Result=Response<User>;';
    expect(await reverse(input, { rootName: 'Result' })).toEqual({ data: { name: '' }, items: [{ name: '' }] });
    expect(await reverse('interface Box<T=string>{value:T}')).toEqual({ value: '' });
    expect(await reverse('type A<T>={v:B<{inner:T}>};type B<T>={value:T};type Result=A<number>', { rootName: 'Result' })).toEqual({ v: { value: { inner: 0 } } });
    await expect(reverse(input)).rejects.toThrow('泛型参数');
  });
  it('generates string-key records, maps, readonly arrays and dates', async () => {
    const output = await reverse('type Root={map:Record<"a"|"b",number>;dict:Record<string,boolean>;zero:Record<0,string>;date:Date;list:ReadonlyArray<string>;tuple:readonly [string,number]}');
    expect(output).toEqual({ map: { a: 0, b: 0 }, dict: { key: false }, zero: { '0': '' }, date: '2026-01-01T00:00:00.000Z', list: [''], tuple: ['', 0] });
  });
  it('handles recursive graphs and prototype-sensitive fields without pollution', async () => {
    expect(await reverse('interface Node {name:string;next:Node;children:Node[];__proto__:{safe:boolean};constructor:string}')).toEqual(JSON.parse('{"name":"","next":null,"children":[null],"__proto__":{"safe":false},"constructor":""}'));
    expect(({} as { safe?: unknown }).safe).toBeUndefined();
    await expect(reverse('interface A extends B{} interface B extends A{}')).rejects.toThrow('循环继承');
  });
  it('does not execute imports, initializers or methods in TS source', async () => {
    expect(await reverse('import type {X} from "https://example.com";globalThis.__devkitExecuted = true; interface Root {name:string;doIt():void}')).toEqual({ name: '' });
    expect((globalThis as { __devkitExecuted?: unknown }).__devkitExecuted).toBeUndefined();
  });
  it('reports unsupported / unresolved TS types, malformed input and missing roots', async () => {
    for (const input of ['interface X {value:External}', 'type X<T> = T extends string ? true : false', 'type X = {[K in "a"]:string}', 'type X = keyof User', 'type X = () => void', 'interface X {', 'const value = 1']) await expect(reverse(input)).rejects.toThrow();
    await expect(reverse('type X=string', { rootName: 'Missing' })).rejects.toThrow('可用类型');
  });
  it('parses Java fields, arrays, nested types and ignores static / transient fields and methods', async () => {
    const input = 'import java.util.List; public class User { private Long id; String name; boolean active; int first, rest[]; List<Profile> profiles; static String CONST="x"; transient String cache; void method(){class Local {String bad;}} public static class Profile{String city;} }';
    expect(await reverse(input, { language: 'java' })).toEqual({ id: 0, name: '', active: false, first: 0, rest: [0], profiles: [{ city: '' }] });
  });
  it('reads Java records, enums, maps, date types, wildcards and annotated fields', async () => {
    const input = 'import java.util.*; public record User(@JsonProperty("user_name") String name, List<? extends Address> addresses, Map<String,Integer> scores, State state, java.time.LocalDate date) { public record Address(String city){} } enum State {ACTIVE,INACTIVE}';
    expect(await reverse(input, { language: 'java' })).toEqual({ user_name: '', addresses: [{ city: '' }], scores: { key: 0 }, state: 'ACTIVE', date: '2026-01-01' });
    expect(await reverse('class X{@JsonIgnore String secret;@JsonProperty(value="显示名") String name;}', { language: 'java' })).toEqual({ '显示名': '' });
    expect(await reverse('class X{@JsonProperty("static") String value;}', { language: 'java' })).toEqual({ static: '' });
    expect(await reverse('record X(String... tags){}', { language: 'java' })).toEqual({ tags: [''] });
  });
  it('supports local Java inheritance, generic references and nested scoped names', async () => {
    const input = 'class User extends Base { List<Box<Profile>> items; static class Profile{String city;} } class Base {long id;} class Box<T>{T value;}';
    expect(await reverse(input, { language: 'java' })).toEqual({ id: 0, items: [{ value: { city: '' } }] });
    expect(await reverse('class A {X a; static class X{String first;}} class B {X b; static class X{int second;}}', { language: 'java', rootName: 'B' })).toEqual({ b: { second: 0 } });
  });
  it('never runs Java initializers, constructors, getters or Lombok annotations', async () => {
    const input = '@Data public class Root {String name=System.getenv("SECRET"); int count=1/0; public Root(){throw new RuntimeException();} public String getSecret(){return "secret";} }';
    expect(await reverse(input, { language: 'java' })).toEqual({ name: '', count: 0 });
  });
  it('reports Java syntax errors, external types and duplicate JSON mappings', async () => {
    for (const input of ['class Root { Missing value; }', 'class Root {String x', 'class Root {@JsonProperty("same") String a; @JsonProperty("same") int b;}', 'class Root extends Missing{}']) await expect(reverse(input, { language: 'java' })).rejects.toThrow();
  });
  it('bounds reverse input, definition count, expansion and sample array counts', async () => {
    await expect(reverse(' '.repeat(200_001))).rejects.toThrow();
    await expect(reverse(Array.from({ length: 501 }, (_, i) => `type T${i}=string;`).join(''))).rejects.toThrow('500');
    for (const arrayLength of ['-1', '6', '1.5', 'bad']) await expect(reverse('type X=string[]', { arrayLength })).rejects.toThrow();
    await expect(reverse('type A=number[][][][][][][]', { arrayLength: '5' })).rejects.toThrow('10,000');
    expect(await reverse('type X=string[]', { arrayLength: '3' })).toEqual(['', '', '']);
  });
  it('roundtrips JSON through both supported generated code formats', async () => {
    const input = '{"id":1,"user_name":"Alice","address":{"city":"上海"},"roles":["admin"]}';
    for (const language of ['ts', 'java']) for (const style of language === 'ts' ? ['interface', 'type'] : ['pojo', 'record']) {
      const generated = await transform('json-code', input, { ...defaultOptions['json-code'], rootName: 'User', language, javaStyle: style, tsStyle: style, annotations: 'jackson', value: 'none' });
      let output;
      try { output = await reverse(generated, { language, rootName: 'User' }); }
      catch (error) { throw new Error(`${language}/${style}: ${String(error)}\n${generated}`); }
      expect(output).toEqual({ id: 0, user_name: '', address: { city: '' }, roles: [''] });
    }
  });
  it('produces a sample assignable to a representative TS definition', async () => {
    const input = 'interface Base{id:number} interface User extends Base{name:string;active:boolean;tags:string[];role:"admin"|"user";note?:string;point:[number,number]}';
    const result = await reverse(input, { rootName: 'User' });
    const filename = '/type-sample.ts', source = `${input}\nconst sample:User=${JSON.stringify(result)};`;
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, strict: true, noEmit: true, types: [] };
    const host = ts.createCompilerHost(options), read = host.getSourceFile;
    host.getSourceFile = (file, language, ...rest) => file === filename ? ts.createSourceFile(file, source, language, true) : read(file, language, ...rest);
    expect(ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host)).map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'))).toEqual([]);
  });
});
