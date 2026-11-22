import { csv, type Opt } from './tabular';
type Frame = {
  id: number;
  callFrame: { functionName: string; url?: string; lineNumber?: number };
  children?: number[];
};
export function profile(input: string, o: Opt) {
  const data = JSON.parse(input),
    nodes = new Map<number, Frame>(),
    parents = new Map<number, number>();
  for (const n of data.nodes as Frame[]) {
    nodes.set(n.id, n);
    for (const c of n.children ?? []) parents.set(c, n.id);
  }
  const samples: number[] = data.samples ?? [],
    deltas: number[] = data.timeDeltas ?? [];
  if (!samples.length || samples.length !== deltas.length) throw Error('需要对应的 samples 和 timeDeltas');
  const sums = new Map<number, number>(),
    rows: unknown[][] = [],
    paths = new Map<number, string>();
  let us = 0;
  function stack(id: number) {
    let path = paths.get(id);
    if (path) return path;
    const seen = new Set<number>(),
      names: string[] = [];
    let cur: number | undefined = id;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      names.unshift(nodes.get(cur)?.callFrame.functionName || '(anonymous)');
      cur = parents.get(cur);
    }
    path = names.join(' → ');
    paths.set(id, path);
    return path;
  }
  for (const [i, id] of samples.entries()) {
    const delta = deltas[i];
    if (!nodes.has(id) || !Number.isFinite(delta) || delta < 0) throw Error('无效采样：' + (i + 1));
    sums.set(id, (sums.get(id) ?? 0) + delta);
    if (o.mode === 'timeline') {
      const last = rows.at(-1);
      if (last && last[3] === id) last[1] = Number(last[1]) + delta / 1000;
      else rows.push([us / 1000, delta / 1000, stack(id), id]);
    }
    us += delta;
  }
  if (o.mode === 'timeline') return csv([['起点 ms', '时长 ms', '调用栈', '节点'], ...rows]);
  return csv([
    ['函数', '自身毫秒', '占比', '调用栈', '源码'],
    ...[...sums]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => {
        const f = nodes.get(id)!.callFrame;
        return [
          f.functionName || '(anonymous)',
          n / 1000,
          (us ? (100 * n) / us : 0).toFixed(2) + '%',
          stack(id),
          f.url ? f.url + ':' + ((f.lineNumber ?? 0) + 1) : '',
        ];
      }),
  ]);
}
type BuildModule = { name?: string; size: number; modules?: BuildModule[] };
export function bundles(input: string, o: Opt) {
  function measure(text: string) {
    const data = JSON.parse(text),
      map = new Map<string, number>(),
      add = (k: string, v: number) => map.set(k, (map.get(k) ?? 0) + v);
    const pkg = (s: string) =>
      s.replace(/\\/g, '/').match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)(?!.*\/node_modules\/)/)?.[1] ??
      '项目源码';
    if (data.outputs) {
      for (const [name, out] of Object.entries(data.outputs) as [
        string,
        { bytes: number; inputs: Record<string, { bytesInOutput: number }> },
      ][]) {
        if (o.mode === 'output') add(name, out.bytes);
        else {
          let assigned = 0;
          for (const [key, node] of Object.entries(out.inputs ?? {})) {
            add(pkg(key), node.bytesInOutput);
            assigned += node.bytesInOutput;
          }
          if (out.bytes > assigned) add('产物包装与其他', out.bytes - assigned);
        }
      }
    } else if (data.assets || data.modules) {
      if (o.mode === 'output') for (const asset of data.assets ?? []) add(asset.name, asset.size);
      else {
        const walk = (mods: BuildModule[]) => {
          for (const m of mods)
            if (m.modules?.length) walk(m.modules);
            else add(pkg(m.name ?? ''), m.size);
        };
        walk(data.modules ?? []);
      }
    } else throw Error('需要 esbuild metafile 或 webpack stats');
    return map;
  }
  const a = measure(input),
    b = measure(o.target);
  return csv([
    ['归属', '原字节', '新字节', '增减字节'],
    ...[...new Set([...a.keys(), ...b.keys()])]
      .map((k) => [k, a.get(k) ?? 0, b.get(k) ?? 0, (b.get(k) ?? 0) - (a.get(k) ?? 0)])
      .sort((x, y) => Number(y[3]) - Number(x[3])),
  ]);
}
export async function optimizeSvg(input: string) {
  if (!/<svg[\s>]/i.test(input)) throw Error('需要有效 SVG 文档');
  const { optimize } = await import('svgo/browser');
  return optimize(input, {
    multipass: true,
    plugins: [
      'removeDoctype',
      'removeXMLProcInst',
      'removeComments',
      'cleanupAttrs',
      'cleanupNumericValues',
      'convertColors',
      'convertPathData',
      'convertTransform',
      'sortAttrs',
    ],
  }).data;
}
export function grid(input: string, o: Opt) {
  const rows = input
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim().split(/\s+/));
  const width = rows[0].length,
    tracks = o.tracks.trim().split(/\s+/).map(Number);
  if (width !== tracks.length || tracks.some((n) => !Number.isFinite(n) || n <= 0))
    throw Error('每列需要一个大于零的宽度比例');
  const gap = Number(o.gap);
  if (!Number.isFinite(gap) || gap < 0) throw Error('间距必须为非负数');
  const bounds = new Map<string, number[]>();
  rows.forEach((row, y) => {
    if (row.length !== width) throw Error('第 ' + (y + 1) + ' 行列数不一致');
    row.forEach((name, x) => {
      if (name === '.') return;
      if (!/^[a-zA-Z_][\w-]*$/.test(name)) throw Error('区域名请使用英文标识符或 .');
      const b = bounds.get(name) ?? [x, y, x, y, 0];
      b[0] = Math.min(b[0], x);
      b[2] = Math.max(b[2], x);
      b[3] = y;
      b[4]++;
      bounds.set(name, b);
    });
  });
  for (const [name, [x, y, r, b, n]] of bounds)
    if ((r - x + 1) * (b - y + 1) !== n) throw Error('区域 ' + name + ' 必须为一个矩形');
  return (
    '.grid {\n  display: grid;\n  gap: ' +
    gap +
    'px;\n  grid-template-columns: ' +
    tracks.map((n) => n + 'fr').join(' ') +
    ';\n  grid-template-areas:\n' +
    rows.map((row) => '    "' + row.join(' ') + '"').join('\n') +
    ';\n}\n' +
    [...bounds.keys()].map((n) => '.' + n + ' { grid-area: ' + n + '; }').join('\n')
  );
}
type Geometry = {
  type: string;
  coordinates?: unknown;
  features?: Geometry[];
  geometry?: Geometry;
  geometries?: Geometry[];
};
export function shapes(input: string) {
  const result: { type: string; paths: number[][][]; name: string }[] = [];
  function visit(g: Geometry, name: string) {
    if (!g) return;
    if (g.type === 'FeatureCollection') {
      g.features?.forEach((f, i) => visit(f, String(i + 1)));
      return;
    }
    if (g.type === 'Feature') {
      if (g.geometry) visit(g.geometry, name);
      return;
    }
    if (g.type === 'GeometryCollection') {
      g.geometries?.forEach((f, i) => visit(f, name + '.' + (i + 1)));
      return;
    }
    const c = g.coordinates as number[][][];
    switch (g.type) {
      case 'MultiPoint':
      case 'MultiLineString':
      case 'MultiPolygon':
        for (const [i, v] of c.entries())
          visit({ type: g.type.slice(5), coordinates: v }, name + '.' + (i + 1));
        return;
      case 'Point':
        result.push({ type: g.type, paths: [[c as unknown as number[]]], name });
        break;
      case 'LineString':
        result.push({ type: g.type, paths: [c as unknown as number[][]], name });
        break;
      case 'Polygon':
        result.push({ type: g.type, paths: c, name });
        break;
      default:
        throw Error('未知要素：' + g.type);
    }
  }
  visit(JSON.parse(input), '1');
  return result;
}
export async function geojson(input: string) {
  const { default: geo } = await import('geographiclib-geodesic'),
    rows: unknown[][] = [['要素', '类型', '长度 / 周长（米）', '面积（平方米）', '检查']];
  for (const shape of shapes(input)) {
    let length = 0,
      area = 0;
    const issues = new Set<string>();
    shape.paths.forEach((coords, i) => {
      const polygon = shape.type === 'Polygon',
        calc = geo.Geodesic.WGS84.Polygon(!polygon);
      if (polygon && (coords.length < 4 || JSON.stringify(coords[0]) !== JSON.stringify(coords.at(-1))))
        issues.add('环未闭合或顶点不足');
      for (const p of coords) {
        if (
          !Array.isArray(p) ||
          p.length < 2 ||
          !Number.isFinite(p[0]) ||
          !Number.isFinite(p[1]) ||
          Math.abs(p[0]) > 180 ||
          Math.abs(p[1]) > 90
        ) {
          issues.add('经纬度越界，请核对顺序');
          return;
        }
        calc.AddPoint(p[1], p[0]);
      }
      const stats = calc.Compute(false, true);
      length += stats.perimeter;
      area += (i ? -1 : 1) * Math.abs(stats.area ?? 0);
    });
    rows.push([
      shape.name,
      shape.type,
      issues.size ? '' : length.toFixed(2),
      shape.type === 'Polygon' && !issues.size ? area.toFixed(2) : '',
      [...issues].join('、') || '通过',
    ]);
  }
  return csv(rows);
}
