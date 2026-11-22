import { Braces, Binary, Link, Clock3, Fingerprint, KeyRound, Regex, Code2, FileCode2, Table2, FileKey2, CaseSensitive, Hash, Code, Pipette, Palette, Contrast, Blend, Paintbrush, SlidersHorizontal, FileJson2, FileSpreadsheet, Database, FileDiff, ScanLine, LockKeyhole, MapPin, Activity, ScrollText, ServerCog, Server, FolderOpen, Send, Terminal } from 'lucide-react';
import { categories, type workspaceModules } from './catalog';
import { QrCode, PanelsTopLeft, ListOrdered, BookOpen, ClipboardList, FolderUp, ArrowLeftRight, Workflow, Presentation } from 'lucide-react';

import { CalendarDays, ChartNoAxesColumn, ChartGantt, FileArchive, Images, Scroll, GitCompareArrows, BookKey, Workflow as FlowIcon, Grid2X2, FileType2, MapPinned, Timer, ListTree, AppWindowMac, Cookie, CalendarRange, GitCommitHorizontal, Languages, Network } from 'lucide-react';
import type {AnalysisId} from './analysis/catalog';
const analysisIcons = {
  reconcile: GitCompareArrows, 'csv-health': FileSpreadsheet, pivot: Table2, 'json-map': FlowIcon, pseudonym: LockKeyhole,
  'mybatis-sql': Database, 'pg-plan': ListTree, 'maven-path': Network, invisible: ScanLine, intervals: CalendarRange,
  'git-ignore': FileCode2, 'npm-lock-diff': GitCompareArrows, changelog: GitCommitHorizontal, 'sbom-diff': ClipboardList,
  'proto-diff': FileDiff, rrule: CalendarDays, tokens: Palette, 'i18n-diff': Languages, 'markdown-lint': BookOpen,
  'ast-search': Code2, 'spring-config': SlidersHorizontal, 'thread-dump': ListTree, 'gc-pauses': Activity, 'source-map': MapPin,
  'har-waterfall': ChartGantt, 'openapi-diff': FileDiff, 'cpu-profile': Activity, 'bundle-size': ChartNoAxesColumn,
  'http-cache': Timer, 'cookie-context': Cookie, 'geojson-map': MapPinned, 'svg-optimize': Paintbrush, 'css-grid': Grid2X2,
  'mermaid-diagram': FlowIcon, 'encoding-repair': Languages, 'pixel-diff': Images, 'excel-inspect': FileSpreadsheet,
  'parquet-view': Table2, 'jar-inspect': FileArchive, 'cert-inspect': BookKey, 'image-compress': Images,
  'favicon-kit': AppWindowMac, 'file-signature': FileType2, 'zip-inventory': FileArchive,
} satisfies Record<AnalysisId, typeof Scroll>;
export const toolIcons = { ...analysisIcons, 'json-lines': Braces, 'markdown-table': Table2, 'qr-code': QrCode, semver: ListOrdered, 'css-flex': PanelsTopLeft, 'mock-data': FileJson2, 'geo-coordinates': MapPin, xml: FileCode2, gzip: Binary, ipv4: Link, chmod: LockKeyhole, ulid: KeyRound, 'text-stats': CaseSensitive, 'code-format': Code2, 'json-path': ScanLine, 'json-schema': FileJson2, 'query-string': Link, 'http-code': FileCode2, cron: Clock3, env: SlidersHorizontal, properties: FileCode2, hmac: FileKey2, unicode: Binary, 'css-unit': SlidersHorizontal, 'http-status': ScanLine, yaml: FileJson2, 'csv-json': FileSpreadsheet, sql: Database, diff: FileDiff, 'url-inspect': ScanLine, password: LockKeyhole, json: Braces, 'json-code': FileCode2, 'type-json': FileJson2, 'json-csv': Table2, base64: Binary, url: Link, html: Code, timestamp: Clock3, hash: Fingerprint, uuid: KeyRound, regex: Regex, jwt: FileKey2, radix: Hash, text: CaseSensitive, 'color-picker': Pipette, 'color-convert': SlidersHorizontal, 'color-palette': Palette, 'color-gradient': Paintbrush, 'color-contrast': Contrast, 'color-mix': Blend };
export const categoryMeta: Record<string, { key: string; description: string }> = Object.fromEntries(categories.map(category => [category.name, category]));
export const categoryOrder = categories.map(category => category.name);

export const workspaceModuleNav = {
  http: { Icon: Send, hint: '接口设计与调试' },
  projects: { Icon: FolderOpen, hint: '项目入口与环境档案' },
  knowledge: { Icon: BookOpen, hint: '部署手册、排查与交接' },
  'project-todos': { Icon: ClipboardList, hint: '纯文本任务与标签' },
  'file-shares': { Icon: FolderUp, hint: '在浏览器下载本机文件' },
  transfer: { Icon: ArrowLeftRight, hint: '文件与文字互传' },
  mock: { Icon: Workflow, hint: '多场景响应与调用记录' },
  whiteboard: { Icon: Presentation, hint: '截图与多人标注' },
  nginx: { Icon: Server, hint: '配置与实例管理' },
  jar: { Icon: ServerCog, hint: '后端服务启停与控制台' },
  monitor: { Icon: Activity, hint: '可用率与故障记录' },
  logs: { Icon: ScrollText, hint: '实时日志多窗对照' },
  'lan-hosts': { Icon: Terminal, hint: '连接档案与 SSH 终端' },
} satisfies Record<typeof workspaceModules[number]['id'], { Icon: typeof Send; hint: string }>;


