import { describe, expect, it, vi } from 'vitest';
import { lanRequest } from './lan-api';
import { SftpQueue } from './sftp-queue';
import type { Entry, Site } from './sftp-sites';

vi.mock('./lan-api', () => ({ lanRequest: vi.fn() }));
const folder: Entry = { path: '/local/folder', name: 'folder', kind: 'directory' };
const children: Entry[] = ['one', 'two'].map((name) => ({
  path: folder.path + '/' + name,
  name,
  kind: 'file',
  size: 4,
}));
function setup() {
  const local: Site = {
    list: async () => ({ directory: folder.path, parent: '/local', entries: children }),
    mkdir: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
  };
  const remote: Site = { ...local, mkdir: vi.fn(async (path, name) => path + '/' + name) };
  const queue = new SftpQueue(
    () => {},
    () => {},
    async () => ({ action: 'skip' }),
  );
  const sites = { local, remote };
  queue.attach('first', sites);
  return { queue, sites };
}
describe('SFTP 传输队列', () => {
  it('加入队列等待启动，断线后在新会话中只重试未完成的文件', async () => {
    const { queue, sites } = setup();
    const calls: string[] = [];
    vi.mocked(lanRequest).mockImplementation(async (action, input) => {
      const value = input as { name: string; id: string };
      if (action === 'sftp-upload') {
        calls.push(value.id + ':' + value.name);
        if (value.id === 'first' && value.name === 'two') throw new Error('连接中断');
      }
      return {};
    });
    queue.add('local', [folder], '/local', '/remote', true);
    expect(queue.jobs[0].state).toBe('held');
    expect(calls).toEqual([]);
    queue.process();
    await vi.waitFor(() => expect(queue.jobs[0].state).toBe('failed'));
    queue.dispose();
    queue.attach('', sites);
    queue.attach('second', sites);
    queue.retry(queue.jobs[0]);
    await vi.waitFor(() => expect(queue.jobs[0].state).toBe('done'));
    expect(calls).toEqual(['first:one', 'first:two', 'second:two']);
    expect(queue.jobs[0]).toMatchObject({ bytes: 8, total: 8, files: 2, count: 2 });
    queue.dispose();
  });
  it('暂停期间取消待传文件不会访问目标', () => {
    const { queue } = setup();
    queue.add('local', children, folder.path, '/remote', true);
    queue.pause();
    queue.cancel(queue.jobs[0]);
    expect(queue.jobs.map((j) => j.state)).toEqual(['cancelled', 'held']);
    queue.clear(['cancelled']);
    expect(queue.jobs.map((j) => j.source.name)).toEqual(['two']);
    queue.dispose();
  });
});
