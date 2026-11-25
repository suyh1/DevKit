import { readFile } from 'node:fs/promises';

const chapters = [
  ['files', '文件与目录'],
  ['search', '查找与筛选'],
  ['read', '文本阅读与比较'],
  ['text', '文本处理与数据提取'],
  ['shell', 'Shell 环境与脚本'],
  ['terminal', '终端与编辑器'],
  ['permissions', '用户、用户组与权限'],
  ['process', '进程与作业'],
  ['performance', '性能与资源观察'],
  ['system', '系统信息与硬件'],
  ['storage', '磁盘与文件系统'],
  ['archive', '归档与压缩'],
  ['services', '服务、日志与调度'],
  ['network', '网络配置与诊断'],
  ['transfer', '文件传输与同步'],
  ['packages', '发行版与软件包'],
  ['development', '编译、构建与二进制分析'],
  ['languages', '语言与开发工具'],
  ['version', '版本管理'],
  ['containers', '容器与部署'],
  ['data', '数据库与数据文件'],
  ['media', '图像、音视频与文档'],
  ['checksums', '校验、编码与签名'],
];

// Stable IDs keep links to the bundled chapters valid across restarts and edits.
export async function linuxManual() {
  return Promise.all(chapters.map(async ([slug, title]) => ({
    id: 'linux-' + slug, title, folder: 'Linux 命令大全', project: '', tags: ['Linux'],
    body: await readFile(new URL('./linux-manual/' + slug + '.md', import.meta.url), 'utf8'),
    actor: 'DevKit', revision: 1, history: [], updated: '2026-11-25T04:08:33.000Z',
  })));
}
