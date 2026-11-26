import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';
import { createTransferService, openTransferFile } from './quick-transfer.mjs';
import { createRelay } from './relay.mjs';
import { boardRequest } from './screenshot-board.mjs';
import { createMockService, mutateDataset } from './mock-service.mjs';

import { fail } from './collab-record.mjs';

export async function createCollabStore(directory, lan) {
  const folder = path.join(directory, 'collaboration');
  await mkdir(folder, { recursive: true });
  const modules = new Map();
  for (const name of ['transfer', 'mock', 'whiteboard', 'relay']) {
    const file = path.join(folder, name + '.json');
    let rows;
    try {
      rows = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      rows = [];
    }
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/.test(row.id))
    )
      fail(500, '协作数据索引无效。');
    modules.set(name, { rows, file, version: randomUUID(), queue: Promise.resolve() });
  }
  const transferState = modules.get('transfer');
  const transfer = await createTransferService(folder, transferState.rows, () => { transferState.version = randomUUID(); });
  const mock = createMockService(() => modules.get('mock').rows, (input, authorize) => request('mock', mutateDataset, input, { authorize }));
  const relay = createRelay(lan, () => { modules.get('relay').version = randomUUID(); });
  const handlers = { relay: relay.request, transfer: transfer.request, whiteboard: boardRequest, mock: mock.request };
  function request(name, action, input = {}, access = {}) {
    const state = modules.get(name);
    if (!state) fail(404, '栏目不存在。');
    const perform = async () => {
      access.authorize?.();
      const commit = async (rows) => {
        const json = JSON.stringify(rows);
        if (Buffer.byteLength(json) > 48 * 1024 * 1024) fail(413, '栏目存储已满，请删除旧项目。');
        await atomicFile(state.file, json, 0o600, { beforeReplace: access.authorize });
        state.rows = rows;
        state.version = randomUUID();
      };
      const args = { rows: state.rows, commit, action, input: input || {}, access, folder };
      if (action === 'list' && input?.sync === true) {
        if (name === 'transfer') await transfer.request({ ...args, action: 'sweep' });
        if (input.version === state.version) return { version: state.version };
        args.rows = state.rows;
        const items = await handlers[name](args);
        return { version: state.version, items };
      }
      return handlers[name](args);
    };
    const result = state.queue.then(perform);
    state.queue = result.catch(() => {});
    return result;
  }
  const timer = setInterval(() => request('transfer', 'sweep').catch((error) => console.error(error.message)), 60_000);
  timer.unref();
  return {
    request,
    releaseDirect(owner) { transfer.release(owner); relay.release(owner); },
    openTransfer: (input, access) => request('transfer', openTransferFile, input, access),
    serveMock: mock.serve,
    async close() {
      clearInterval(timer);
      await Promise.all([...modules.values()].map((state) => state.queue));
      relay.close();
      await transfer.close();
    },
  };
}
