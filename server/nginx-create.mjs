import { lstat, mkdir, open, readFile, realpath, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

function configName(value) {
  if (typeof value !== 'string' || value.length > 100 || !/^[\p{L}\p{N} _.-]+\.conf$/u.test(value) || value !== value.trim() || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value)) throw new Error('配置文件名须为普通 .conf 文件名，可使用文字、数字、空格、点、短横线和下划线。');
  return value;
}
export function nginxStarter({ mainName = 'nginx.conf', commonName = 'common_proxy.conf', port = 8080 } = {}) {
  mainName = configName(mainName); commonName = configName(commonName);
  if (mainName.toLowerCase() === commonName.toLowerCase()) throw new Error('主文件和附属文件不能同名。');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('监听端口必须是 1–65535 的整数。');
  const main = `# DevKit 创建的跨平台配置；相对路径以实例运行目录为准。\nworker_processes 1;\npid logs/nginx.pid;\nerror_log logs/error.log;\n\nevents {\n    worker_connections 1024;\n}\n\nhttp {\n    # 常用静态类型内联，无需另外准备 mime.types。\n    types {\n        text/html html htm;\n        text/css css;\n        application/javascript js;\n        application/json json;\n        image/png png;\n        image/jpeg jpg jpeg;\n        image/svg+xml svg;\n    }\n    default_type application/octet-stream;\n    access_log logs/access.log;\n    sendfile on;\n    keepalive_timeout 65;\n    client_max_body_size 100M;\n    client_body_temp_path temp/client_body;\n    proxy_temp_path temp/proxy;\n    fastcgi_temp_path temp/fastcgi;\n    uwsgi_temp_path temp/uwsgi;\n    scgi_temp_path temp/scgi;\n\n    server {\n        # 如需局域网访问，可在字段中改成 ${port} 或指定网卡地址。\n        listen 127.0.0.1:${port};\n        server_name localhost;\n\n        location / {\n            root html;\n            index index.html;\n            try_files $uri $uri/ /index.html;\n        }\n\n        include ${JSON.stringify(commonName)};\n    }\n}\n`;
  const common = '# 公共代理规则；主文件在 server 块中 include 本文件。\n# 按需修改后端地址与路径，保存后检查并重载实例。\nlocation /api/ {\n    proxy_pass http://127.0.0.1:9000;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n}\n';
  const index = '<!doctype html>\n<html lang="zh-CN"><meta charset="utf-8"><title>Nginx ready</title><h1>Nginx ready</h1><p>配置已由 DevKit 创建。请在字段配置中调整静态目录和公共代理。</p></html>\n';
  return { mainName, commonName, main, common, index };
}
const exists = async file => { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;

// Commit registration only after the whole set is written. Rollback never touches
// preexisting files or a new file which has since been changed by another writer.
export async function createNginxConfigSet(directory, settings, register) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\0\r\n]/.test(directory)) throw new Error('请选择已有目录的本机绝对路径。');
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) throw new Error('配置目录不是文件夹。');
  const template = nginxStarter(settings);
  const main = path.join(root, template.mainName), common = path.join(root, template.commonName);
  for (const file of [main, common]) if (await exists(file)) throw new Error(`目标文件已存在，请更换目录或文件名：${file}`);
  const dirs = [], files = [];
  function withinRoot(file) {
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('创建路径越出所选目录。');
  }
  async function makeDirectory(name) {
    const target = path.join(root, name); withinRoot(target);
    try { await mkdir(target); dirs.push({ path: target, info: await lstat(target) }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`所需子目录已被文件或链接占用：${target}`);
    }
  }
  async function createFile(target, content, optional = false) {
    withinRoot(target);
    let handle;
    try { handle = await open(target, 'wx', optional ? 0o644 : 0o600); }
    catch (error) {
      if (error.code === 'EEXIST' && optional) {
        const info = await lstat(target);
        if (info.isFile() && !info.isSymbolicLink()) return;
      }
      if (error.code === 'EEXIST') throw new Error(`目标文件已存在，请更换目录或文件名：${target}`);
      throw error;
    }
    try {
      files.push({ path: target, info: await handle.stat(), bytes: Buffer.from(content) });
      await handle.writeFile(content, 'utf8'); await handle.sync();
    } finally { await handle.close(); }
  }
  try {
    for (const name of ['logs', 'temp', 'html']) await makeDirectory(name);
    await createFile(main, template.main); await createFile(common, template.common);
    await createFile(path.join(root, 'html', 'index.html'), template.index, true);
    return await register({ main, files: [common], prefix: root });
  } catch (error) {
    const retained = [];
    for (const file of files.reverse()) {
      try {
        withinRoot(file.path);
        const info = await exists(file.path);
        if (!info) continue;
        const bytes = info.isFile() && !info.isSymbolicLink() ? await readFile(file.path) : null;
        if (!sameFile(info, file.info) || !bytes || !bytes.equals(file.bytes)) { retained.push(file.path); continue; }
        await unlink(file.path);
      } catch { retained.push(file.path); }
    }
    for (const dir of dirs.reverse()) {
      try { withinRoot(dir.path); const current = await exists(dir.path); if (current && sameFile(current, dir.info) && current.isDirectory() && !current.isSymbolicLink()) await rmdir(dir.path); }
      catch (failure) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(failure.code)) retained.push(dir.path); }
    }
    throw new Error(`${error.message}${retained.length ? `；以下新建内容已变化或清理失败，已保留：${retained.join('、')}` : '；本次创建已撤销，原有内容未改动。'}`);
  }
}
