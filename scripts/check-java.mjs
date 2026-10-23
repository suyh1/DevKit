import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { jsonToJava } from '../src/generators.ts';

const directory = resolve('artifacts/generated-java');
mkdirSync(directory, { recursive: true });
const samples = [
  { rootName: 'GeneratedPojo', style: 'pojo', input: '{"id":9007199254740993,"cost":12.5,"huge":9223372036854775808,"user_name":"Alice","class":true,"foo-bar":{},"foo_bar":{"a":1},"中文":null,"getClass":"x","items":[{"id":1,"note":"A"},{"id":2,"cost":1.5}],"empty":[],"nullable":[{"profile":null},{"profile":{"city":"上海"}}]}' },
  { rootName: 'GeneratedRecord', style: 'record', input: '{"toString":"a","getClass":true,"hashCode":1,"notify":{},"wait":[],"list":[{"a":1},{"b":true}],"user_name":"Alice"}' },
  { rootName: 'GeneratedArray', style: 'pojo', input: '[{"id":1,"name":"Alice"},{"id":3000000000,"note":null}]' },
  { rootName: 'GeneratedEmptyRecord', style: 'record', input: '{}' },
];
const files = samples.map(sample => {
  const filename = join(directory, sample.rootName + '.java');
  writeFileSync(filename, jsonToJava(sample.input, sample), 'utf8');
  return filename;
});
execFileSync(process.argv[2] || process.env.JAVAC || 'javac', ['--release', '17', '-encoding', 'UTF-8', '-d', directory, ...files], { stdio: 'inherit' });
console.log(`Java 17 compilation passed for ${files.length} generated POJO / Record / array-root / empty-record fixtures.`);
