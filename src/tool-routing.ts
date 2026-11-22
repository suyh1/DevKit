import type { Options, ToolId } from './tools';
import type { EditorLanguage } from './CodeEditor';

// A new task receives the exact result text; only compatible input settings are selected.
export function resultInputOptions(source: ToolId, options: Options, target: ToolId, language: EditorLanguage): Options {
  // The YAML destination is offered only for results confirmed to be JSON,
  // including decoded text whose editor language is still plain text.
  if (target === 'json-lines') return { mode: 'lines' };
  if (source === 'json-csv' && target === 'markdown-table') return { mode: 'markdown', delimiter: options.delimiter };
  if (source === 'markdown-table' && target === 'csv-json') return { delimiter: options.delimiter };
  if (target === 'yaml') return { mode: 'json-yaml' };
  if (target === 'type-json') return { language: language === 'java' ? 'java' : 'ts' };
  if (target === 'code-format') return { language: language === 'typescript' ? 'typescript' : language === 'css' ? options.language === 'scss' ? 'scss' : 'css' : language === 'html' ? 'html' : 'babel' };
  if (source === 'json-csv' && target === 'csv-json') return { delimiter: options.delimiter, headers: 'first', types: 'strings' };
  if (source !== target) return {};
  if (['base64', 'url', 'html', 'unicode', 'query-string', 'env', 'properties'].includes(source)) return { mode: options.mode === 'encode' ? 'decode' : 'encode' };
  if (source === 'json' && options.mode === 'stringify') return { mode: 'parse' };
  if (source === 'json' && options.mode === 'parse') return { mode: 'stringify' };
  if (source === 'gzip') return { mode: options.mode === 'compress' ? 'decompress' : 'compress' };
  return {};
}
