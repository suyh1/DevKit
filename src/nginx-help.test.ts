import { describe, expect, it } from 'vitest';
import { parseNginx } from '../shared/nginx.mjs';
import { directiveHint } from './nginx-help';

describe('nginx help follows configuration context', () => {
  it('distinguishes a virtual server from an upstream backend node', () => {
    const http = parseNginx('http { upstream backend { server 127.0.0.1:9001; } server { listen 9011; } }')[0];
    expect(directiveHint(http.children[0].children[0], 'http/upstream').detail).toContain('后端节点');
    expect(directiveHint(http.children[1], 'http').detail).toContain('前端站点');
  });
  it('uses address-only guidance for stream proxying and HTTP URL guidance for locations', () => {
    const [stream, http] = parseNginx('stream { server { proxy_pass 127.0.0.1:9001; } } http { server { location /api/ { proxy_pass http://127.0.0.1:9001; } } }');
    const tcp = directiveHint(stream.children[0].children[0], 'stream/server');
    const web = directiveHint(http.children[0].children[0].children[0], 'http/server/location');
    expect(tcp.example).not.toContain('http://');
    expect(tcp.detail).toContain('TCP/UDP');
    expect(web.example).toMatch(/^http:\/\//);
    expect(web.detail).toContain('末尾 /');
  });
  it('separates runtime-relative paths from configuration-relative includes and certificates', () => {
    const nodes = parseNginx('pid logs/nginx.pid; error_log logs/error.log warn; include common_proxy.conf; ssl_certificate cert/site.pem;');
    expect(nodes.map(node => directiveHint(node).base)).toEqual(['prefix', 'prefix', 'config', 'config']);
  });
  it('keeps module-specific parameters open without inventing instructions', () => {
    const node = parseNginx('custom_module $name "unchanged value";')[0];
    const help = directiveHint(node);
    expect(help.example).toBeUndefined();
    expect(help.detail).toContain('模块文档');
    expect(node.args).toBe('$name "unchanged value"');
  });
});
