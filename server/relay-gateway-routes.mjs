import { block, ipv4 } from './relay-gateway.mjs';
import { routingAddress } from './relay-routing.mjs';
import { fail } from './collab-record.mjs';

// A selected aggregate can contain exceptions using a different exit. Keep the
// longest-prefix decision for each part, including paths via the installing router.
export function directRoutePlan(networks, links, routes = []) {
  const root = {};
  function nodeFor(network) {
    if (network === '0.0.0.0/0') return root;
    const range = block(network);
    if (!range || range.cidr !== network) fail(400, '出口路由的 IPv4 前缀无效。');
    let node = root;
    const length = Number(network.split('/')[1]);
    for (let depth = 0; depth < length; depth++) {
      const bit = (range.start >>> (31 - depth)) & 1;
      node = node[bit] ??= {};
    }
    return node;
  }
  for (const link of links) {
    const node = nodeFor(link.network);
    (node.connected ??= []).push({ device: link.device });
  }
  for (const path of routes) {
    const node = nodeFor(path.network);
    const metric = path.metric ?? 0;
    if (!Number.isFinite(metric)) fail(400, '路由跃点数无效。');
    if (path.gateway) routingAddress(path.gateway);
    if (node.metric === undefined || metric < node.metric) {
      node.metric = metric;
      node.paths = [];
    }
    if (metric === node.metric) node.paths.push(path);
  }
  for (const network of networks) nodeFor(network).selected = true;

  return function destinations(link) {
    const lan = block(link.network), entries = [];
    function visit(node, start, depth, selected, paths) {
      selected ||= node?.selected;
      paths = node?.paths ?? node?.connected ?? paths;
      const size = 2 ** (32 - depth);
      if (node?.[0] || node?.[1]) {
        const mark = entries.length;
        visit(node[0], start, depth + 1, selected, paths);
        visit(node[1], start + size / 2, depth + 1, selected, paths);
        // Merge only complete sibling ranges with identical next-hop exclusions.
        if (selected && entries.length === mark + 2 && entries[mark].depth === depth + 1 &&
            entries[mark + 1].depth === depth + 1 && entries[mark].hops === entries[mark + 1].hops) {
          entries[mark].depth = depth;
          entries.pop();
        }
      } else if (selected) {
        if (start >= lan.start && start + size - 1 <= lan.end &&
            paths.some(p => !p.gateway && p.device === link.device)) return;
        const hops = [...new Set(paths.map(p => p.gateway).filter(Boolean))].sort().join(' ');
        entries.push({ start, depth, hops });
      }
    }
    visit(root, 0, 0, false, []);
    return entries.map(({ start, depth, hops }) => [ipv4(start) + '/' + depth, hops].filter(Boolean).join(' '));
  };
}
