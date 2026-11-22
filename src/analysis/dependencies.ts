import { csv, type Opt } from './tabular';
import semver from 'semver';
export async function ignorePaths(input: string, o: Opt) {
  const { default: ignore } = await import('ignore'),
    lines = input.split(/\r?\n/);
  const matcher = ignore();
  lines.forEach((pattern, i) => matcher.add({ pattern, mark: String(i + 1) }));
  const exclusions = lines.flatMap((line, i) =>
    line.startsWith('!') && line.length > 1 ? [{ line: i + 1, matcher: ignore().add(line.slice(1)) }] : [],
  );
  const rows: unknown[][] = [['相对路径', '结果', '规则行', '命中规则或说明']];
  for (const raw of o.target.split(/\r?\n/).filter(Boolean)) {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    try {
      const result = matcher.checkIgnore(path);
      if (result.ignored) rows.push([raw, '忽略', result.rule?.mark, result.rule?.pattern]);
      else {
        let line = 0;
        if (matcher.test(path).unignored)
          for (const rule of exclusions) if (rule.matcher.ignores(path)) line = rule.line;
        rows.push([
          raw,
          line ? '保留（重新包含）' : '保留',
          line || '',
          line ? lines[line - 1] : '没有命中排除规则',
        ]);
      }
    } catch (e) {
      rows.push([raw, '无效路径', '', (e as Error).message]);
    }
  }
  return csv(rows);
}
type LockNode = { version?: string; dependencies?: Record<string, LockNode> };
function packages(input: string) {
  const lock = JSON.parse(input),
    map = new Map<string, string>();
  if (lock.packages) {
    for (const [name, raw] of Object.entries(lock.packages))
      if (name) map.set(name, (raw as LockNode).version ?? '本地链接');
  } else if (lock.dependencies) {
    const walk = (deps: Record<string, LockNode>, base: string) => {
      for (const [name, node] of Object.entries(deps)) {
        const path = base + 'node_modules/' + name;
        map.set(path, node.version ?? '');
        if (node.dependencies) walk(node.dependencies, path + '/');
      }
    };
    walk(lock.dependencies, '');
  } else if (lock.lockfileVersion !== 1) throw Error('无法识别 package-lock.json');
  return map;
}
export function npmDiff(input: string, o: Opt) {
  const a = packages(input),
    b = packages(o.target),
    versions = new Map<string, Set<string>>();
  for (const [path, v] of b) {
    const name = path.split('node_modules/').at(-1)!;
    const all = versions.get(name) ?? new Set();
    all.add(v);
    versions.set(name, all);
  }
  const rows: unknown[][] = [['变化', '安装路径', '原版本', '新版本', '新版中的全部版本']];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path),
      y = b.get(path),
      all = versions.get(path.split('node_modules/').at(-1)!);
    if (x === y && (all?.size ?? 0) < 2) continue;
    const change =
      x === undefined
        ? '新增'
        : y === undefined
          ? '移除'
          : x === y
            ? '多版本并存'
            : semver.valid(x) && semver.valid(y)
              ? semver.gt(y, x)
                ? '升级'
                : semver.lt(y, x)
                  ? '降级'
                  : '版本变化'
              : '版本变化';
    rows.push([change, path, x, y, [...(all ?? [])].join(' / ')]);
  }
  return csv(rows);
}
export function changelog(input: string) {
  const groups = new Map<string, string[]>();
  for (const raw of input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)) {
    const line = raw.replace(/^[a-f\d]{5,64}\s+/i, ''),
      m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(line);
    const group =
      /^BREAKING[ -]CHANGE:/i.test(line) || m?.[3]
        ? '破坏性变更'
        : m?.[1] === 'feat'
          ? '新增功能'
          : m?.[1] === 'fix'
            ? '问题修复'
            : m?.[1] === 'perf'
              ? '性能改进'
              : m?.[1] === 'docs'
                ? '文档'
                : '其他变更';
    const item = m ? (m[2] ? '**' + m[2] + '** · ' : '') + m[4] : line;
    const list = groups.get(group) ?? [];
    list.push('- ' + item);
    groups.set(group, list);
  }
  if (!groups.size) throw Error('请输入提交记录');
  return [
    '# 更新说明',
    ...['破坏性变更', '新增功能', '问题修复', '性能改进', '文档', '其他变更']
      .filter((k) => groups.has(k))
      .map((k) => '## ' + k + '\n\n' + groups.get(k)!.join('\n')),
  ].join('\n\n');
}
type Component = {
  name: string;
  group?: string;
  type?: string;
  version?: string;
  licenses?: { expression?: string; license?: { id?: string; name?: string } }[];
  components?: Component[];
};
function components(input: string) {
  const bom = JSON.parse(input);
  if (bom.bomFormat !== 'CycloneDX') throw Error('请输入 CycloneDX JSON');
  const out = new Map<string, string[][]>();
  function walk(list: Component[]) {
    for (const c of list) {
      const key = [c.type, c.group, c.name].filter(Boolean).join('/');
      const group = out.get(key) ?? [];
      group.push([
        c.version ?? '',
        (c.licenses ?? [])
          .map((x) => x.expression ?? x.license?.id ?? x.license?.name ?? '')
          .sort()
          .join(' / '),
      ]);
      out.set(key, group);
      if (c.components) walk(c.components);
    }
  }
  walk(bom.components ?? []);
  return out;
}
export function sbom(input: string, o: Opt) {
  const a = components(input),
    b = components(o.target),
    rows: unknown[][] = [['状态', '组件', '原版本 / 许可', '新版本 / 许可']];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const left = (a.get(key) ?? [])
        .map((x) => x.join(' · '))
        .sort()
        .join('\n'),
      right = (b.get(key) ?? [])
        .map((x) => x.join(' · '))
        .sort()
        .join('\n');
    if (left !== right) rows.push([!left ? '新增' : !right ? '移除' : '变更', key, left, right]);
  }
  return csv(rows);
}
export async function proto(input: string, o: Opt) {
  const { parse, Type, Namespace } = await import('protobufjs');
  const types = (source: string) => {
    const root = parse(source, { keepCase: true }).root,
      map = new Map<string, InstanceType<typeof Type>>();
    const walk = (ns: InstanceType<typeof Namespace>) => {
      for (const obj of ns.nestedArray) {
        if (obj instanceof Type) map.set(obj.fullName, obj);
        if (obj instanceof Namespace) walk(obj);
      }
    };
    walk(root);
    return map;
  };
  const a = types(input),
    b = types(o.target),
    rows: unknown[][] = [['消息', '字段号', '原字段', '新字段', '变化']];
  for (const [name, old] of a) {
    const next = b.get(name);
    if (!next) {
      rows.push([name, '', '', '', '消息删除']);
      continue;
    }
    for (const field of old.fieldsArray) {
      const n = next.fieldsById[field.id],
        show = (f: typeof field) => [f.rule, f.type, f.name].filter(Boolean).join(' ');
      const status = !n
        ? next.isReservedId(field.id)
          ? '字段删除（已保留编号）'
          : '字段删除但编号未保留'
        : [
            n.name !== field.name ? '字段号复用或重命名' : '',
            n.type !== field.type ? '类型变化' : '',
            n.repeated !== field.repeated ? '重复性变化' : '',
          ]
            .filter(Boolean)
            .join('、');
      if (status) rows.push([name, field.id, show(field), n ? show(n) : '', status]);
    }
  }
  return csv(rows);
}
export async function recurrence(input: string, o: Opt) {
  const lib = await import('rrule'),
    { rrulestr } = lib.default ?? lib;
  const count = Number(o.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) throw Error('次数需为 1 至 500 的整数');
  const format = new Intl.DateTimeFormat('zh-CN', { timeZone: o.zone, dateStyle: 'full', timeStyle: 'long' });
  const rule = rrulestr(input.trim());
  return csv([
    ['序号', 'UTC', o.zone],
    ...rule
      .all((_date: Date, i: number) => i < count)
      .map((date: Date, i: number) => [i + 1, date.toISOString(), format.format(date)]),
  ]);
}
