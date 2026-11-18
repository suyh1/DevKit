import { Braces, Binary, Link, Clock3, Fingerprint, KeyRound, Regex, Code2, FileCode2, Table2, FileKey2, CaseSensitive, Hash, Code, Pipette, Palette, Contrast, Blend, Paintbrush, SlidersHorizontal, FileJson2, FileSpreadsheet, Database, FileDiff, ScanLine, LockKeyhole, MapPin, Activity, ScrollText, Coffee, Server, FolderOpen, Send, Terminal } from 'lucide-react';
import { categories, type workspaceModules } from './catalog';
import { ClipboardList, FolderUp } from 'lucide-react';

export const toolIcons = { 'mock-data': FileJson2, 'geo-coordinates': MapPin, xml: FileCode2, gzip: Binary, ipv4: Link, chmod: LockKeyhole, ulid: KeyRound, 'text-stats': CaseSensitive, 'code-format': Code2, 'json-path': ScanLine, 'json-schema': FileJson2, 'query-string': Link, 'http-code': FileCode2, cron: Clock3, env: SlidersHorizontal, properties: FileCode2, hmac: FileKey2, unicode: Binary, 'css-unit': SlidersHorizontal, 'http-status': ScanLine, yaml: FileJson2, 'csv-json': FileSpreadsheet, sql: Database, diff: FileDiff, 'url-inspect': ScanLine, password: LockKeyhole, json: Braces, 'json-code': FileCode2, 'type-json': FileJson2, 'json-csv': Table2, base64: Binary, url: Link, html: Code, timestamp: Clock3, hash: Fingerprint, uuid: KeyRound, regex: Regex, jwt: FileKey2, radix: Hash, text: CaseSensitive, 'color-picker': Pipette, 'color-convert': SlidersHorizontal, 'color-palette': Palette, 'color-gradient': Paintbrush, 'color-contrast': Contrast, 'color-mix': Blend };
export const categoryMeta: Record<string, { key: string; description: string }> = Object.fromEntries(categories.map(category => [category.name, category]));
export const categoryOrder = categories.map(category => category.name);

export const workspaceModuleNav = {
  http: { Icon: Send, hint: '接口设计与调试' },
  projects: { Icon: FolderOpen, hint: '项目入口与环境档案' },
  'project-todos': { Icon: ClipboardList, hint: '项目进度与待办看板' },
  'file-shares': { Icon: FolderUp, hint: '在浏览器下载本机文件' },
  nginx: { Icon: Server, hint: '配置与实例管理' },
  jar: { Icon: Coffee, hint: '应用启停与控制台' },
  monitor: { Icon: Activity, hint: '可用率与故障记录' },
  logs: { Icon: ScrollText, hint: '实时日志多窗对照' },
  'lan-hosts': { Icon: Terminal, hint: '连接档案与 SSH 终端' },
} satisfies Record<typeof workspaceModules[number]['id'], { Icon: typeof Send; hint: string }>;


