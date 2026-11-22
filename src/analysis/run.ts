import { health, jsonMap, pivot, pseudonym, reconcile, type Opt } from './tabular';
import { intervals, invisible, maven, mybatis, pgPlan } from './diagnostics';
import { ignorePaths, npmDiff, changelog, sbom, proto, recurrence } from './dependencies';
import { tokens, locale, markdown, astSearch } from './content';
import { spring, threads, gc, sourceMap } from './runtime';
import { har, cache, cookie, contract } from './network';
import { profile, bundles, optimizeSvg, grid, geojson } from './visual';
const handlers: Record<string, (input: string, options: Opt) => Promise<string> | string> = {
  'git-ignore': ignorePaths,
  'npm-lock-diff': npmDiff,
  changelog,
  'sbom-diff': sbom,
  'proto-diff': proto,
  rrule: recurrence,
  tokens,
  'i18n-diff': locale,
  'markdown-lint': markdown,
  'ast-search': astSearch,
  'spring-config': spring,
  'thread-dump': threads,
  'gc-pauses': gc,
  'source-map': sourceMap,
  'har-waterfall': har,
  'openapi-diff': contract,
  'cpu-profile': profile,
  'bundle-size': bundles,
  'http-cache': cache,
  'cookie-context': cookie,
  'geojson-map': geojson,
  'svg-optimize': optimizeSvg,
  'css-grid': grid,
  'mermaid-diagram': async (input) => (await import('./mermaid')).renderDiagram(input),
  reconcile,
  'csv-health': health,
  pivot,
  'json-map': jsonMap,
  pseudonym,
  'mybatis-sql': mybatis,
  'pg-plan': pgPlan,
  'maven-path': maven,
  invisible,
  intervals,
};
export function runAnalysis(id: string, input: string, options: Opt) {
  const handler = handlers[id];
  if (!handler) throw Error('请在工具中选择本地文件');
  return handler(input, options);
}
