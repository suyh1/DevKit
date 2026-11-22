import { csv, type Opt } from './tabular';
type HarEntry = {
  request: { url: string; method?: string };
  response: { status: number; bodySize: number; _transferSize?: number };
  startedDateTime: string;
  time: number;
  timings: Record<string, number>;
};
export function har(input: string, o: Opt) {
  const entries: HarEntry[] = JSON.parse(input).log?.entries;
  if (!Array.isArray(entries)) throw Error('需要 HAR log.entries 列表');
  const points = entries.map((e) => ({
    url: e.request.url,
    method: e.request.method ?? '',
    host: new URL(e.request.url).hostname,
    start: Date.parse(e.startedDateTime),
    time: e.time,
    bytes: Math.max(0, e.response._transferSize ?? e.response.bodySize),
    status: e.response.status,
    t: e.timings,
  }));
  if (o.sort === 'domain') {
    const groups = new Map<string, number[]>();
    for (const p of points) {
      const b = groups.get(p.host) ?? [0, 0, 0];
      b[0]++;
      b[1] += p.bytes;
      b[2] += p.time;
      groups.set(p.host, b);
    }
    return csv([
      ['域名', '请求数', '传输字节', '累计请求毫秒'],
      ...[...groups].sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => [k, ...v]),
    ]);
  }
  const start = points.reduce((min, p) => Math.min(min, p.start), Infinity);
  points.sort((a, b) =>
    o.sort === 'slow' ? b.time - a.time : o.sort === 'large' ? b.bytes - a.bytes : a.start - b.start,
  );
  return csv([
    [
      'URL',
      '方法',
      '状态',
      '起点 ms',
      '总计 ms',
      '字节',
      '阻塞',
      'DNS',
      '连接（含 TLS）',
      '发送',
      '等待首字节',
      '下载',
    ],
    ...points.map((p) => [
      p.url,
      p.method,
      p.status,
      p.start - start,
      p.time,
      p.bytes,
      ...['blocked', 'dns', 'connect', 'send', 'wait', 'receive'].map((k) => (p.t[k] >= 0 ? p.t[k] : '')),
    ]),
  ]);
}
export function cache(input: string, o: Opt) {
  const headers = new Headers();
  for (const line of input.trim().split(/\r?\n/)) {
    if (line.startsWith('HTTP/')) continue;
    const at = line.indexOf(':');
    if (at < 1) throw Error('无效响应头：' + line);
    headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const directives = new Map(
    (headers.get('cache-control') ?? '').split(',').map((s) => {
      const [k, v] = s.trim().split('=');
      return [k.toLowerCase(), v?.replace(/"/g, '') ?? ''];
    }),
  );
  const received = Date.parse(o.received),
    now = Date.parse(o.at);
  if (!Number.isFinite(received) || !Number.isFinite(now) || now < received)
    throw Error('观察时间必须有效并晚于或等于接收时间');
  const parsedDate = Date.parse(headers.get('date') ?? '');
  const date = Number.isFinite(parsedDate) ? parsedDate : received,
    shared = o.cache === 'shared';
  const age =
    Math.max(0, (received - date) / 1000, Number(headers.get('age') ?? 0)) + (now - received) / 1000;
  const directive = shared && directives.has('s-maxage') ? 's-maxage' : 'max-age';
  const expires = Date.parse(headers.get('expires') ?? '');
  const lifetime = directives.has(directive)
    ? Number(directives.get(directive))
    : Number.isFinite(expires)
      ? Math.max(0, (expires - date) / 1000)
      : null;
  const state =
    directives.has('no-store') || (shared && directives.has('private'))
      ? '禁止存储'
      : directives.has('no-cache')
        ? '使用前必须验证'
        : lifetime === null
          ? '无显式新鲜期'
          : age < lifetime
            ? '新鲜'
            : '已过期';
  return csv([
    ['检查项', '结果'],
    ['结论', state],
    ['当前年龄（秒）', age],
    ['显式新鲜期（秒）', lifetime ?? '未指定'],
    ['剩余秒数', lifetime === null ? '' : Math.max(0, lifetime - age)],
    ['If-None-Match', headers.get('etag')],
    ['If-Modified-Since', headers.get('last-modified')],
  ]);
}
export async function cookie(input: string, o: Opt) {
  const { getDomain } = await import('tldts');
  const origin = new URL(o.origin),
    req = new URL(o.url),
    page = new URL(o.page);
  const site = (u: URL) =>
    u.protocol + '//' + (getDomain(u.hostname, { allowPrivateDomains: true }) ?? u.hostname);
  const rows: unknown[][] = [['Cookie', '结论', '域名', '路径', 'Secure', 'SameSite', '其他条件']];
  for (const line of input.trim().split(/\r?\n/)) {
    const [first, ...parts] = line.replace(/^Set-Cookie:\s*/i, '').split(';');
    const at = first.indexOf('=');
    if (at < 1) throw Error('首项应为 Cookie 名称和值');
    const attrs = new Map(
      parts.map((s) => {
        const [k, ...v] = s.trim().split('=');
        return [k.toLowerCase(), v.join('=')];
      }),
    );
    const domain = (attrs.get('domain') ?? origin.hostname).replace(/^\./, '').toLowerCase();
    const matches = (h: string) => h === domain || h.endsWith('.' + domain);
    const domainOK = attrs.has('domain')
      ? matches(req.hostname) &&
        matches(origin.hostname) &&
        (domain === origin.hostname || !!getDomain(domain, { allowPrivateDomains: true }))
      : req.hostname === origin.hostname;
    const raw = attrs.get('path'),
      path = raw?.startsWith('/') ? raw : origin.pathname.slice(0, origin.pathname.lastIndexOf('/')) || '/';
    const pathOK = req.pathname === path || req.pathname.startsWith(path.endsWith('/') ? path : path + '/');
    const secureOK = !attrs.has('secure') || (origin.protocol === 'https:' && req.protocol === 'https:');
    const mode = (attrs.get('samesite') ?? 'lax').toLowerCase(),
      same = site(req) === site(page);
    const siteOK =
      mode === 'none'
        ? attrs.has('secure')
        : same || (mode !== 'strict' && o.context === 'nav' && /^(GET|HEAD|OPTIONS|TRACE)$/i.test(o.method));
    const max = attrs.get('max-age'),
      expired =
        max !== undefined && /^-?\d+$/.test(max)
          ? Number(max) <= 0
          : Date.parse(attrs.get('expires') ?? '') <= Date.now();
    rows.push([
      first.slice(0, at),
      domainOK && pathOK && secureOK && siteOK && !expired ? '发送' : '不发送',
      domain + (domainOK ? ' ✓' : ' ×'),
      path + (pathOK ? ' ✓' : ' ×'),
      secureOK ? '通过' : '需要 HTTPS',
      mode + (siteOK ? ' ✓' : ' ×'),
      expired ? '已过期' : attrs.has('httponly') ? 'HttpOnly' : '',
    ]);
  }
  return csv(rows);
}
type Schema = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  $ref?: string;
};
type Parameter = { name: string; in: string; required?: boolean; schema?: Schema };
type Media = { content?: Record<string, { schema?: Schema }> };
type Operation = {
  parameters?: Parameter[];
  requestBody?: Media & { required?: boolean };
  responses?: Record<string, Media>;
};
type Spec = {
  openapi: string;
  paths: Record<string, Record<string, Operation> & { parameters?: Parameter[] }>;
};
export async function contract(input: string, o: Opt) {
  const { parse } = await import('yaml'),
    a: Spec = parse(input),
    b: Spec = parse(o.target);
  if (!a?.openapi || !b?.openapi || !a.paths || !b.paths) throw Error('请提供两份 OpenAPI 3 JSON 或 YAML');
  function deref<T>(v: T, root: Spec): T {
    let cur: unknown = v;
    const seen = new Set<string>();
    while (cur && typeof cur === 'object' && '$ref' in cur && typeof cur.$ref === 'string') {
      const ref = cur.$ref;
      if (!ref.startsWith('#/') || seen.has(ref)) break;
      seen.add(ref);
      cur = root;
      for (const part of ref.slice(2).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        cur =
          cur && typeof cur === 'object' && Object.hasOwn(cur, key)
            ? (cur as Record<string, unknown>)[key]
            : undefined;
      }
    }
    return cur as T;
  }
  const blocks: string[] = [];
  for (const [path, item] of Object.entries(a.paths))
    for (const method of Object.keys(item).filter((k) =>
      /^(get|post|put|delete|options|patch|head|trace)$/.test(k),
    )) {
      const left = deref(item[method], a),
        next = b.paths[path],
        right = deref(next?.[method], b),
        issues: string[] = [];
      function compare(
        x: Schema | undefined,
        y: Schema | undefined,
        location: string,
        request: boolean,
        seen = new Set<Schema>(),
      ) {
        x = deref(x, a);
        y = deref(y, b);
        if (!x || !y || seen.has(x)) return;
        const trail = new Set([...seen, x]);
        if (request)
          for (const k of y.required ?? [])
            if (!x.required?.includes(k)) issues.push('请求新增必填字段 ' + location + '.' + k);
        if (request && y.enum && (!x.enum || x.enum.some((v) => !y!.enum!.includes(v))))
          issues.push('请求枚举收窄 ' + location + ' → ' + JSON.stringify(y.enum));
        for (const [key, sub] of Object.entries(x.properties ?? {})) {
          const dest = y.properties?.[key];
          if (!request && !dest) issues.push('响应移除字段 ' + location + '.' + key);
          else compare(sub, dest, location + '.' + key, request, trail);
        }
        if (x.items && y.items) compare(x.items, y.items, location + '[]', request, trail);
      }
      if (!right) issues.push('移除操作，原有调用将失效');
      else {
        const params = (list: Parameter[], root: Spec) =>
          new Map(
            list.map((p) => {
              const v = deref(p, root);
              return [v.in + '.' + v.name, v];
            }),
          );
        const old = params([...(item.parameters ?? []), ...(left.parameters ?? [])], a),
          updated = params([...(next.parameters ?? []), ...(right.parameters ?? [])], b);
        for (const [key, p] of updated) {
          if (p.required && !old.get(key)?.required) issues.push('新增必填参数 ' + key);
          compare(old.get(key)?.schema, p.schema, key, true);
        }
        const lb = deref(left.requestBody, a),
          rb = deref(right.requestBody, b);
        if (rb?.required && !lb?.required) issues.push('请求体变为必填');
        for (const [type, media] of Object.entries(rb?.content ?? {}))
          compare(lb?.content?.[type]?.schema, media.schema, 'body', true);
        for (const [status, resp] of Object.entries(left.responses ?? {})) {
          const r = deref(right.responses?.[status], b);
          if (!r) {
            issues.push('响应状态移除 ' + status);
            continue;
          }
          for (const [type, media] of Object.entries(deref(resp, a)?.content ?? {})) {
            const updated = r.content?.[type];
            if (!updated) issues.push('响应类型移除 ' + status + ' ' + type);
            else compare(media.schema, updated.schema, '响应 ' + status, false);
          }
        }
      }
      if (issues.length)
        blocks.push(
          '## ' + method.toUpperCase() + ' ' + path + '\n\n' + issues.map((i) => '- ' + i).join('\n'),
        );
    }
  return (
    '# OpenAPI 兼容性报告\n\n' +
    (blocks.join('\n\n') || '本次检查未发现操作、请求参数或响应字段的不兼容变化。')
  );
}
