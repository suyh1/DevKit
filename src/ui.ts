import { Braces, Binary, Link, Clock3, Fingerprint, KeyRound, Regex, Code2, FileCode2, Table2, FileKey2, CaseSensitive, Hash, Code, Pipette, Palette, Contrast, Blend, Paintbrush, SlidersHorizontal, FileJson2, FileSpreadsheet, Database, FileDiff, ScanLine, LockKeyhole } from 'lucide-react';

export const toolIcons = { xml: FileCode2, gzip: Binary, ipv4: Link, chmod: LockKeyhole, ulid: KeyRound, 'text-stats': CaseSensitive, 'code-format': Code2, 'json-path': ScanLine, 'json-schema': FileJson2, 'query-string': Link, 'http-code': FileCode2, cron: Clock3, env: SlidersHorizontal, properties: FileCode2, hmac: FileKey2, unicode: Binary, 'css-unit': SlidersHorizontal, 'http-status': ScanLine, yaml: FileJson2, 'csv-json': FileSpreadsheet, sql: Database, diff: FileDiff, 'url-inspect': ScanLine, password: LockKeyhole, json: Braces, 'json-code': FileCode2, 'type-json': FileJson2, 'json-csv': Table2, base64: Binary, url: Link, html: Code, timestamp: Clock3, hash: Fingerprint, uuid: KeyRound, regex: Regex, jwt: FileKey2, radix: Hash, text: CaseSensitive, 'color-picker': Pipette, 'color-convert': SlidersHorizontal, 'color-palette': Palette, 'color-gradient': Paintbrush, 'color-contrast': Contrast, 'color-mix': Blend };
import { categories } from './catalog';
export const categoryMeta: Record<string, { key: string; description: string }> = Object.fromEntries(categories.map(category => [category.name, category]));
export const categoryOrder = categories.map(category => category.name);


