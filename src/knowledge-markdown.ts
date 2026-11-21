import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false }).disable('image');
export const resourceKinds = [
  'knowledge',
  'jar',
  'nginx',
  'projects',
  'lan-hosts',
  'http',
  'monitor',
] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export const resourceNames: Record<ResourceKind, string> = {
  knowledge: '知识库文档',
  jar: '后端服务',
  nginx: 'Nginx 实例',
  projects: '项目入口',
  'lan-hosts': '局域网主机',
  http: '接口',
  monitor: '监控项',
};
export function resourceTarget(hash: string) {
  const match = /^#([^/]+)\/(.+)$/.exec(hash);
  const page = resourceKinds.find((kind) => kind === match?.[1]);
  if (!match || !page) return;
  try {
    return { page, id: decodeURIComponent(match[2]) };
  } catch {
    return;
  }
}
// Only explicit web links and resource references are actionable in a shared article.
md.validateLink = (href) => /^https?:\/\//i.test(href) || !!resourceTarget(href);
md.renderer.rules.link_open = (tokens, i, options, _env, renderer) => {
  if (!resourceTarget(tokens[i].attrGet('href') ?? '')) {
    tokens[i].attrSet('target', '_blank');
    tokens[i].attrSet('rel', 'noopener noreferrer');
  }
  return renderer.renderToken(tokens, i, options);
};
export function renderArticle(body: string) {
  return md.render(body);
}
export function articleLayout(body: string) {
  const tokens = md.parse(body, {}),
    headings: { key: string; title: string; level: number }[] = [];
  const counts = new Map<string, number>();
  tokens.forEach((token, i) => {
    if (token.map) token.attrSet('data-kb-line', String(token.map[0]));
    if (token.type !== 'heading_open') return;
    const title = tokens[i + 1]?.content ?? '';
    let hash = 2166136261;
    for (const ch of title) hash = Math.imul(hash ^ ch.codePointAt(0)!, 16777619);
    const base = (hash >>> 0).toString(36),
      count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    const key = 'h' + base + '-' + count;
    token.attrSet('data-kb-heading', key);
    headings.push({ key, title, level: Number(token.tag.slice(1)) });
  });
  return { html: md.renderer.render(tokens, md.options, {}), headings };
}
export function bodyMatch(body: string, query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return;
  const offset = body.toLowerCase().indexOf(term);
  if (offset < 0) return;
  const start = body.lastIndexOf('\n', offset - 1) + 1,
    end = body.indexOf('\n', offset);
  return {
    line: body.slice(0, start).split('\n').length - 1,
    snippet: body.slice(
      Math.max(start, offset - 32),
      Math.min(end < 0 ? body.length : end, offset + term.length + 52),
    ),
  };
}
export function refersTo(body: string, page: ResourceKind, id: string) {
  return md.parse(body, {}).some((block) =>
    block.children?.some((token) => {
      if (token.type !== 'link_open') return false;
      const target = resourceTarget(token.attrGet('href') ?? '');
      return target?.page === page && (page === 'knowledge' ? target.id.split('~')[0] : target.id) === id;
    }),
  );
}
export function referenceText(page: ResourceKind, id: string, label: string) {
  const clean = label.replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&');
  const encoded = encodeURIComponent(id).replace(/[()]/g, (char) => '%' + char.charCodeAt(0).toString(16));
  return '[' + clean + '](#' + page + '/' + encoded + ')';
}
