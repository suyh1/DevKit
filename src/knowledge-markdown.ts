import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false }).disable('image');
export const resourceKinds = ['jar', 'nginx', 'projects', 'lan-hosts', 'http', 'monitor'] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export const resourceNames: Record<ResourceKind, string> = {
  jar: 'JAR 实例',
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
export function refersTo(body: string, page: ResourceKind, id: string) {
  return md.parse(body, {}).some((block) =>
    block.children?.some((token) => {
      if (token.type !== 'link_open') return false;
      const target = resourceTarget(token.attrGet('href') ?? '');
      return target?.page === page && target.id === id;
    }),
  );
}
export function referenceText(page: ResourceKind, id: string, label: string) {
  const clean = label.replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&');
  const encoded = encodeURIComponent(id).replace(/[()]/g, (char) => '%' + char.charCodeAt(0).toString(16));
  return '[' + clean + '](#' + page + '/' + encoded + ')';
}
