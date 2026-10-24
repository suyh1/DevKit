import { defaultOptions, tools } from './tools';
import type { Options, ToolId } from './tools';
import { validateGeoOptions } from './geo-config';

export type TaskStatus = 'idle' | 'running' | 'success' | 'error' | 'stale' | 'cancelled';
export type Task = {
  id: string; toolId: ToolId; input: string; output: string; options: Options;
  error: string; elapsed: number | null; status: TaskStatus; fileName?: string; encoding?: string;
};
export type Preferences = {
  theme: 'system' | 'light' | 'dark'; fontSize: number; indent: '2' | '4'; wrap: boolean;
  layout: 'split' | 'stack'; density: 'comfortable' | 'compact'; library: 'grid' | 'list'; startup: ToolId | 'home';
};
export const defaultPreferences: Preferences = { theme: 'system', fontSize: 13, indent: '2', wrap: true, layout: 'split', density: 'comfortable', library: 'grid', startup: 'home' };
export const MAX_TASKS = 12;
export function isToolId(value: unknown): value is ToolId { return tools.some(tool => tool.id === value); }
export function normalizeToolId(value: unknown): ToolId | undefined {
  if (value === 'json-java' || value === 'json-ts') return 'json-code';
  return isToolId(value) ? value : undefined;
}
export function normalizeFavorites(value: unknown): ToolId[] {
  return Array.isArray(value) ? [...new Set(value.map(normalizeToolId).filter((id): id is ToolId => !!id))] : [];
}
export function createTask(toolId: ToolId, indent = '2', input?: string): Task {
  return { id: crypto.randomUUID(), toolId, input: input ?? (['uuid', 'ulid'].includes(toolId) ? '5' : ''), output: '', options: { ...defaultOptions[toolId], ...(['json', 'xml', 'sql', 'code-format'].includes(toolId) ? { indent } : {}) }, error: '', elapsed: null, status: 'idle' };
}
export function editTask(task: Task, patch: Partial<Task>): Task {
  return { ...task, ...patch, error: '', status: task.elapsed !== null || task.output !== '' ? 'stale' : 'idle' };
}
export function changeToolOption(task: Task, key: string, value: string): Partial<Task> {
  const options = { ...task.options, [key]: value };
  if (task.toolId !== 'ulid' || key !== 'mode' || value === task.options.mode) return { options };
  const from = task.options.mode === 'parse' ? 'parseInput' : 'generateInput';
  const to = value === 'parse' ? 'parseInput' : 'generateInput';
  options[from] = task.input;
  if (from === 'parseInput') options.parseVisited = 'on';
  // A first switch after generation uses the actual generated IDs, never an unrelated example.
  const input = to === 'generateInput' ? options[to] ?? '5' : options.parseVisited === 'on' ? options[to] ?? '' : task.status === 'success' ? task.output : options[to] ?? '';
  return { input, options, fileName: undefined, encoding: undefined };
}
export function validatePreferences(value: unknown): Preferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const choose = <Key extends keyof Preferences>(key: Key, values: readonly Preferences[Key][]): Preferences[Key] => values.includes(source[key] as Preferences[Key]) ? source[key] as Preferences[Key] : defaultPreferences[key];
  return {
    theme: choose('theme', ['system', 'light', 'dark']), fontSize: choose('fontSize', [12, 13, 14, 15, 16, 17, 18]),
    indent: choose('indent', ['2', '4']), wrap: choose('wrap', [true, false]), layout: choose('layout', ['split', 'stack']),
    density: choose('density', ['comfortable', 'compact']), library: choose('library', ['grid', 'list']),
    startup: normalizeToolId(source.startup) ?? 'home',
  };
}
export function workspaceSnapshot(tasks: Task[], activeId: string | null, includeSensitive = false): string {
  const saved = tasks.filter(task => !task.toolId.startsWith('color-') && (includeSensitive || !['password', 'jwt', 'hmac'].includes(task.toolId)));
  const snapshot = JSON.stringify({ format: 'devkit-workspace', version: 1, active: saved.findIndex(task => task.id === activeId), tasks: saved.map(({ toolId, input, output, options, elapsed, fileName, encoding }) => ({ toolId, input, output, options, elapsed, fileName, encoding })) }, null, 2);
  if (snapshot.length > 12_000_000) throw new Error('工作区超过 12,000,000 字符，请分别导出结果并关闭部分任务后再保存。');
  return snapshot;
}
export function importWorkspace(text: string): { tasks: Task[]; active: number } {
  if (text.length > 12_000_000) throw new Error('工作区文件超过 12 MB 字符限制。');
  const source = JSON.parse(text);
  if (source?.format !== 'devkit-workspace' || source.version !== 1 || !Array.isArray(source.tasks) || source.tasks.length > MAX_TASKS) throw new Error('不是受支持的 DevKit 工作区（最多 12 个任务）。');
  const tasks = source.tasks.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('工作区任务格式无效。');
    const entry = item as Record<string, unknown>;
    const toolId = normalizeToolId(entry.toolId);
    if (!toolId || toolId.startsWith('color-')) throw new Error('工作区包含不支持的工具。');
    if (typeof entry.input !== 'string' || typeof entry.output !== 'string' || entry.input.length > 2_000_000 || entry.output.length > 4_000_000) throw new Error('工作区输入或结果超出限制。');
    if (!entry.options || typeof entry.options !== 'object' || Array.isArray(entry.options)) throw new Error('工作区参数无效。');
    const task = createTask(toolId);
    const options = { ...task.options };
    const incoming = Object.fromEntries(Object.entries(entry.options));
    if (entry.toolId === 'json-java' || entry.toolId === 'json-ts') {
      incoming.language = entry.toolId === 'json-java' ? 'java' : 'ts';
      if (Object.hasOwn(incoming, 'style')) incoming[entry.toolId === 'json-java' ? 'javaStyle' : 'tsStyle'] = incoming.style;
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (!Object.hasOwn(task.options, key)) continue;
      if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('工作区参数超出限制。');
      options[key] = value;
    }
    if (toolId === 'geo-coordinates') {
      validateGeoOptions(options);
      if (entry.input.length > 300_000) throw new Error('经纬度文本超过 300,000 字符。');
    }
    return { ...task, input: entry.input, output: entry.output, options, elapsed: null, status: 'stale' as const, fileName: typeof entry.fileName === 'string' ? entry.fileName.slice(0, 200) : undefined };
  });
  return { tasks, active: Number.isInteger(source.active) && source.active >= 0 && source.active < tasks.length ? source.active : 0 };
}

