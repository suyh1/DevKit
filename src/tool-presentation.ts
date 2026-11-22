import type { ToolId, Options } from './tools';
import type { EditorLanguage } from './CodeEditor';

export function developerPresentation(id: ToolId, options: Options): { input: EditorLanguage; output: EditorLanguage; extension: string; preview?: boolean; sample?: string } | undefined {
  if (id === 'json-lines') return options.mode === 'lines' ? { input: 'json', output: 'text', extension: 'jsonl', sample: '[{"id":9007199254740993},{"id":2}]' } : { input: 'text', output: 'json', extension: 'json', preview: true };
  if (id === 'markdown-table') return { input: 'text', output: 'text', extension: options.mode === 'delimited' ? options.delimiter === 'tab' ? 'tsv' : 'csv' : 'md', preview: true,
    sample: options.mode === 'delimited' ? '| 编号 | 备注 |\n| --- | --- |\n| 001 | 文档 |' : options.delimiter === 'tab' ? '编号\t备注\n001\t文档' : undefined };
  if (id === 'semver') return { input: 'text', output: 'json', extension: 'json', preview: true };
  if (id === 'json-schema' && options.mode === 'validate') return { input: 'json', output: 'text', extension: 'txt', preview: false };
  if (id === 'regex' && options.mode === 'replace') return { input: 'text', output: 'text', extension: 'txt', preview: false };
  if (id === 'timestamp' && options.mode === 'batch') return { input: 'text', output: 'text', extension: 'tsv', preview: true, sample: '1735689600\n1751328000\n待核对' };
  if (id === 'json' && options.mode === 'parse') return { input: 'json', output: 'json', extension: 'json', preview: true, sample: JSON.stringify('{"name":"DevKit","tags":["开发","测试"]}') };
  if (id === 'json' && options.mode === 'stringify') return { input: 'json', output: 'json', extension: 'json', preview: false };
  if (id === 'diff' && options.mode === 'json') return { input: 'json', output: 'json', extension: 'json', preview: true, sample: '{"id":9007199254740993,"name":"张三","active":true}' };
  if (id === 'mock-data') return { input: 'json', output: options.format === 'csv' ? 'text' : 'json', extension: options.format === 'csv' ? 'csv' : 'json', preview: true, sample: options.source === 'schema' ? '{"type":"object","properties":{"id":{"type":"integer","minimum":1,"maximum":10000},"email":{"type":"string","format":"email"},"active":{"type":"boolean"}},"required":["id","email"]}' : undefined };
  if (id === 'xml') return { input: 'xml', output: 'xml', extension: 'xml' };
  if (['ipv4', 'chmod', 'text-stats'].includes(id)) return { input: 'text', output: 'json', extension: 'json', preview: true };
  if (id === 'ulid') return options.mode === 'parse' ? { input: 'text', output: 'json', extension: 'json', preview: true, sample: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } : { input: 'text', output: 'text', extension: 'txt', preview: true };
  if (id === 'gzip') return { input: 'text', output: 'text', extension: 'txt', sample: options.mode === 'decompress' ? 'H4sIAAAAAAACA/NIzcnJBwCCidH3BQAAAA==' : undefined };
  if (id === 'json-code') return { input: 'json', output: options.language === 'java' ? 'java' : 'typescript', extension: options.language === 'java' ? 'java' : 'ts' };
  if (id === 'type-json') return { input: options.language === 'java' ? 'java' : 'typescript', output: 'json', extension: 'json', preview: true,
    sample: options.language === 'java' ? 'import java.util.List;\n\npublic class User {\n    private Long id;\n    private String name;\n    private boolean active;\n    private Profile profile;\n    private List<String> tags;\n\n    public static class Profile {\n        private String city;\n    }\n}' : undefined };
  if (id === 'code-format') {
    const language = options.language === 'babel' ? 'javascript' : options.language === 'typescript' ? 'typescript' : ['css', 'scss'].includes(options.language) ? 'css' : options.language === 'html' ? 'html' : 'text';
    const extension = options.language === 'babel' ? 'jsx' : options.language === 'typescript' ? 'tsx' : options.language;
    const samples: Record<string, string> = { typescript: 'type User={name:string;active:boolean};const user:User={name:"Alice",active:true}', css: '.card{display:flex;gap:16px;color:#147d64}', scss: '$accent:#147d64;.card{color:$accent;&:hover{opacity:.8}}', html: '<main><h1>DevKit</h1><p>你好，开发者</p></main>' };
    return { input: language, output: language, extension, sample: samples[options.language] };
  }
  if (['json-path', 'json-schema'].includes(id)) return { input: 'json', output: 'json', extension: 'json', preview: true };
  if (id === 'http-code') return { input: 'json', output: options.style === 'curl' ? 'text' : 'javascript', extension: options.style === 'curl' ? 'sh' : 'js' };
  if (['env', 'properties', 'query-string'].includes(id)) {
    const encode = options.mode === 'encode';
    return { input: encode ? 'json' : 'text', output: encode ? 'text' : 'json', extension: encode ? id === 'env' ? 'env' : id === 'properties' ? 'properties' : 'txt' : 'json', preview: !encode,
      sample: encode ? id === 'query-string' ? '{"name":"张三","tag":["java","react"],"empty":""}' : id === 'env' ? '{"APP_NAME":"DevKit","PORT":"3000","MESSAGE":"你好\\n开发者"}' : '{"server.port":"8080","welcome":"你好","path":"C:\\\\data"}' : undefined };
  }
  if (['cron', 'http-status'].includes(id)) return { input: 'text', output: 'json', extension: 'json', preview: true };
  if (id === 'css-unit') return { input: 'text', output: 'css', extension: 'txt', sample: ['16', '24', '-8', '1.5'].map(value => value + options.from).join('\n') };
  if (id === 'unicode' && options.mode === 'decode') return { input: 'text', output: 'text', extension: 'txt', sample: '\\u4f60\\u597d DevKit \\ud83d\\ude04' };
  return undefined;
}
