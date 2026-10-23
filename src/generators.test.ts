import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { transform } from './tools';

function typecheck(source: string): void {
  const filename = '/generated-devkit.ts';
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, strict: true, noEmit: true, skipLibCheck: true, types: [] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (file, language, ...rest) => file === filename ? ts.createSourceFile(file, source, language, true) : original(file, language, ...rest);
  const program = ts.createProgram([filename], options, host);
  const errors = ts.getPreEmitDiagnostics(program).map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  expect(errors, source).toEqual([]);
}

describe('JSON code generators', () => {
  it('infers Java numeric ranges from original tokens without rounding', async () => {
    const output = await transform('json-java', '{"small":2147483647,"longId":9007199254740993,"huge":9223372036854775808,"cost":1.25,"nullable":null,"enabled":true}', { rootName: 'Payment' });
    expect(output).toContain('public class Payment');
    expect(output).toContain('Integer small');
    expect(output).toContain('Long longId');
    expect(output).toContain('BigInteger huge');
    expect(output).toContain('BigDecimal cost');
    expect(output).toContain('Object nullable');
    expect(output).toContain('Boolean enabled');
    expect(output).toContain('public void setLongId(Long longId)');
  });
  it('merges every object in arrays, marks missing fields and promotes numeric types', async () => {
    const input = '{"orders":[{"id":1,"label":"A"},{"id":3000000000,"cost":1.5}],"tags":["a",null],"matrix":[[],[1,2]],"mixed":[1,"two"]}';
    const java = await transform('json-java', input);
    expect(java).toContain('List<OrdersItem> orders');
    expect(java).toContain('public static class OrdersItem');
    expect(java).toContain('Long id');
    expect(java).toContain('String label');
    expect(java).toContain('BigDecimal cost');
    expect(java).toContain('List<String> tags');
    expect(java).toContain('List<List<Integer>> matrix');
    expect(java).toContain('List<Object> mixed');
    const output = await transform('json-ts', input, { value: 'include' });
    expect(output).toContain('label?: string;');
    expect(output).toContain('cost?: number;');
    expect(output).toContain('tags: Array<string | null>');
    typecheck(output);
  });
  it('handles duplicate class hints, empty containers and nullable nested objects', async () => {
    const input = '{"foo-bar":{"a":1},"foo_bar":{"b":true},"rows":[{"detail":null},{"detail":{"text":"ok"}}],"empty":[],"nothing":{}}';
    const java = await transform('json-java', input);
    expect(java).toContain('private FooBar fooBar');
    expect(java).toContain('private FooBar2 fooBar2');
    expect(java).toContain('List<Object> empty');
    expect(java).toContain('Detail detail');
    typecheck(await transform('json-ts', input, { value: 'include' }));
  });
  it('supports object-array roots and rejects unsupported Java roots', async () => {
    const output = await transform('json-java', '[{"a":1},{"b":"x"},null]', { rootName: 'Entry' });
    expect(output).toContain('java.util.List<Entry>');
    expect(output).toContain('Integer a');
    expect(output).toContain('String b');
    for (const input of ['[]', '[1,2]', '42', 'null', '[{},1]']) await expect(transform('json-java', input)).rejects.toThrow();
  });
  it('sanitizes Java field names, reserved words and record method conflicts', async () => {
    const input = '{"class":"a","1st-name":"b","user_name":"c","user-name":"d","getClass":"e","toString":"f","中文":true}';
    const java = await transform('json-java', input, { style: 'record', rootName: 'User', annotations: 'jackson' });
    expect(java).toContain('public record User(');
    expect(java).toContain('String classValue');
    expect(java).toContain('String field1stName');
    expect(java).toContain('String userName2');
    expect(java).toContain('String getClassValue');
    expect(java).toContain('String toStringValue');
    expect(java).toContain('@JsonProperty("user_name")');
  });
  it('rejects invalid and conflicting root identifiers', async () => {
    for (const rootName of ['bad-name', '1Root', 'class', 'String']) await expect(transform('json-java', '{}', { rootName })).rejects.toThrow();
    for (const rootName of ['a.b', '123', 'interface', 'Array']) await expect(transform('json-ts', '{}', { rootName })).rejects.toThrow();
  });
  it('typechecks TypeScript interface/type outputs and all supported root forms', async () => {
    const inputs = ['{"id":1,"not-valid":"x","__proto__":{"a":1}}', '[{"a":1},{"b":true}]', '[1,"a",null,{}]', 'null', 'true', '"你好"', '42', '[]'];
    for (const input of inputs) for (const style of ['interface', 'type']) typecheck(await transform('json-ts', input, { rootName: 'Model', style, value: 'include' }));
  });
  it('keeps large TS numeric spelling and supports types-only output', async () => {
    const output = await transform('json-ts', '{"id":9007199254740993,"value":1e400}', { rootName: 'ResponseData', style: 'type', value: 'include' });
    expect(output).toContain('9007199254740993');
    expect(output).toContain('1e400');
    typecheck(output);
    expect(await transform('json-ts', '{}')).not.toContain('export const');
  });
  it('uses Map-backed properties safely for prototype-related keys', async () => {
    const input = '{"constructor":{"prototype":true},"__proto__":{"safe":1},"toString":null}';
    const output = await transform('json-ts', input, { value: 'include' });
    expect(output).toContain('["__proto__"]:');
    typecheck(output);
    expect(await transform('json-java', input)).toContain('getConstructor()');
  });
});
