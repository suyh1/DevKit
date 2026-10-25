// A span-based syntax tree: editing one field never regenerates the document.
export const MAX_CONFIG_SIZE = 2_000_000;
export function parseNginx(source) {
  if (typeof source !== 'string' || source.length > MAX_CONFIG_SIZE) throw new Error('配置文件最多 2,000,000 字符。');
  const tokens = [];
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0, line = 1;
  const fail = message => { throw new Error(`第 ${line} 行：${message}`); };
  while (i < source.length) {
    if (/\s/.test(source[i])) { if (source[i++] === '\n') line++; continue; }
    if (source[i] === '#') { while (i < source.length && source[i] !== '\n') i++; continue; }
    const start = i, tokenLine = line;
    if (';{}'.includes(source[i])) { tokens.push({ start, end: ++i, raw: source[start], line: tokenLine }); continue; }
    let quote = '';
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') { i++; if (i === source.length) fail('末尾转义不完整'); if (source[i++] === '\n') line++; continue; }
      if (quote) { if (c === quote) quote = ''; if (c === '\n') line++; i++; continue; }
      if (c === '"' || c === "'") { quote = c; i++; continue; }
      if (c === '$' && source[i + 1] === '{') {
        const end = source.indexOf('}', i + 2);
        if (end < 0) fail('变量缺少右花括号');
        i = end + 1; continue;
      }
      if (/\s/.test(c) || ';{}#'.includes(c)) break;
      i++;
    }
    if (quote) fail('字符串缺少闭合引号');
    tokens.push({ start, end: i, raw: source.slice(start, i), line: tokenLine });
  }
  let index = 0, count = 0;
  function nodes(depth) {
    if (depth > 64) throw new Error('配置嵌套超过 64 层。');
    const result = [];
    while (index < tokens.length && tokens[index].raw !== '}') {
      const first = tokens[index++];
      if (';{'.includes(first.raw)) throw new Error(`第 ${first.line} 行：缺少指令名称`);
      const args = [];
      while (index < tokens.length && ![';', '{', '}'].includes(tokens[index].raw)) args.push(tokens[index++]);
      const terminator = tokens[index++];
      if (!terminator || terminator.raw === '}') throw new Error(`第 ${first.line} 行：指令缺少分号或配置块`);
      if (++count > 30000) throw new Error('配置指令超过 30,000 项。');
      const node = { id: first.start, name: first.raw, start: first.start, end: terminator.end, line: first.line,
        argsStart: args[0]?.start ?? first.end, argsEnd: args.at(-1)?.end ?? first.end,
        args: args.length ? source.slice(args[0].start, args.at(-1).end) : '',
        values: args.map(token => unquoteNginx(token.raw)), block: terminator.raw === '{', bodyEnd: terminator.start, children: [] };
      if (node.block) {
        node.children = nodes(depth + 1);
        const close = tokens[index++];
        if (!close || close.raw !== '}') throw new Error(`第 ${first.line} 行：配置块缺少 }`);
        node.bodyEnd = close.start; node.end = close.end;
      }
      result.push(node);
    }
    return result;
  }
  const result = nodes(0);
  if (index !== tokens.length) throw new Error(`第 ${tokens[index].line} 行：多余的 }`);
  return result;
}
export function unquoteNginx(value) {
  if ((value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
  return value.replace(/\\([\\"' #;{}])/g, '$1').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\n/g, '\n');
}
export function flattenNginx(nodes) { return nodes.flatMap(node => [node, ...flattenNginx(node.children)]); }
export function editNginxArgs(source, node, args) {
  const check = parseNginx(`${node.name} ${args}${node.block ? ' {}' : ';'}`);
  if (check.length !== 1 || check[0].name !== node.name || check[0].block !== node.block || check[0].args !== args.trim()) throw new Error('字段只填写参数；不要填写分号、注释或其他指令。');
  return source.slice(0, node.argsStart) + (node.argsStart === node.argsEnd ? ' ' : '') + args.trim() + source.slice(node.argsEnd);
}
export function insertNginx(source, parent, snippet) {
  parseNginx(snippet);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const at = parent ? parent.bodyEnd : source.length;
  const indent = parent ? (source.slice(source.lastIndexOf('\n', parent.start - 1) + 1, parent.start).match(/^\s*/)?.[0] ?? '') + '    ' : '';
  const addition = eol + snippet.trim().split(/\r?\n/).map(line => indent + line).join(eol) + eol;
  return source.slice(0, at) + addition + source.slice(at);
}
export const nginxFields = {
  user: ['运行用户', 'Linux 用户和可选用户组；Windows 不支持此指令'], worker_processes: ['工作进程数', 'auto 或正整数'],
  worker_connections: ['每进程最大连接数', '例如 1024'], error_log: ['错误日志', '文件路径和可选日志级别'], pid: ['PID 文件', '每个并行实例使用不同路径；运行期间请勿更改'],
  include: ['引入文件', '相对路径基于主配置文件所在目录；支持通配符'], listen: ['监听地址 / 端口', '例如 9011 或 443 ssl'],
  server_name: ['域名', '多个名称以空格分隔'], root: ['静态文件目录', 'Windows 配置路径使用 /'], alias: ['目录别名', '注意 location 与 alias 的末尾斜杠'],
  index: ['首页文件', '例如 index.html index.htm'], try_files: ['文件回退规则', '例如 $uri $uri/ /index.html'],
  proxy_pass: ['代理目标', '例如 http://127.0.0.1:9001；末尾 / 会影响路径转发'], proxy_set_header: ['代理请求头', '头名称和对应值，允许重复指令'],
  client_max_body_size: ['上传大小上限', '例如 100M'], keepalive_timeout: ['长连接超时', '例如 65'], sendfile: ['零拷贝发送', 'on / off'],
  default_type: ['默认 MIME 类型', '例如 application/octet-stream'], access_log: ['访问日志', '日志路径、格式或 off'],
  ssl_certificate: ['证书路径', 'PEM 文件'], ssl_certificate_key: ['证书私钥路径', 'PEM 文件'], return: ['响应 / 重定向', '状态码和可选地址'],
};
