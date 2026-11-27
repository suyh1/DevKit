// Run with the same account that normally opens DevKit.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createJarManager } from '../server/jar-manager.mjs';

async function recover() {
  const { values } = parseArgs({ options: {
    configs: { type: 'string', default: '/opt/devkit/configs' },
    stop: { type: 'string' },
    'force-stop': { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node recover-linux-service.mjs [--configs 配置目录] [--stop 服务名称或ID]\n停止超时可用 --force-stop 服务名称或ID。默认列出本机服务。请先从托盘退出 DevKit，以便打开同一份运行记录。');
    return;
  }
  if (process.platform !== 'linux') throw new Error('此恢复工具适用于 Linux。');
  const configs = path.resolve(values.configs);
  if (!(await stat(path.join(configs, 'jar/instances.json')).catch(() => null))?.isFile())
    throw new Error('未找到 jar/instances.json，请用 --configs 指定 DevKit 的实际配置目录。');
  const manager = await createJarManager(configs);
  try {
    const { instances } = await manager.request('get');
    if (values.stop !== undefined && values['force-stop'] !== undefined) throw new Error('每次请选择一种停止方式。');
    const selected = values.stop ?? values['force-stop'];
    if (selected !== undefined) {
      const matches = instances.filter(item => item.id === selected || item.name === selected);
      if (matches.length !== 1) throw new Error('请先查看列表，再用唯一的服务名称或 ID 指定要停止的服务。');
      const { status, output } = await manager.request('command', { id: matches[0].id, command: values.stop !== undefined ? 'stop' : 'force-stop' });
      if (!['stopped', 'exited'].includes(status.state)) throw new Error(status.detail);
      console.log(matches[0].name, output);
      return;
    }
    const statuses = await manager.request('statuses');
    console.table(instances.map((item, index) => ({
      '服务名称': item.name, ID: item.id, '状态': { running: '运行中', stopped: '已停止', exited: '已退出', unknown: '待核实' }[statuses[index].state],
      '说明': statuses[index].detail,
    })));
  } finally { await manager.close(); }
}

recover().catch(error => { console.error(error.message); process.exitCode = 1; });
