import { describe, expect, it } from 'vitest';
import { parseHostCsv, parseSshHosts } from './lan-import';

describe('LAN host import', () => {
  it('maps quoted CSV cells and connection metadata without taking credentials', () => {
    const [host] = parseHostCsv('NAME,address,user,port,group,tags,pinned,nginx,password\n"Web, test",ssh.test,operator,2200,Test,web|nginx,1,true,ignored');
    expect(host).toMatchObject({ name: 'Web, test', address: 'ssh.test', user: 'operator', port: 2200, group: 'Test', tags: ['web', 'nginx'], pinned: true, modules: { jar: false, nginx: true } });
    expect(host).not.toHaveProperty('password');
    expect(() => parseHostCsv('name,Address,address\nTest,first,second')).toThrow('唯一');
  });

  it('reads SSH aliases and first matching options without evaluating Match or command directives', () => {
    const hosts = parseSshHosts(`
      Host test\nHostName="test.internal" # comment\n  User tester\n  ProxyCommand ignored
      Host lab* !lab-a\n  Port 2200
      Host lab-a lab-b\n  HostName %h.internal
      Match exec ignored\n  User ignored
      Host *\n  User fallback\n  Port 22
    `);
    expect(hosts.map(({ name, address, user, port }) => [name, address, user, port])).toEqual([
      ['test', 'test.internal', 'tester', 22], ['lab-a', 'lab-a.internal', 'fallback', 22], ['lab-b', 'lab-b.internal', 'fallback', 2200],
    ]);
    expect(hosts.some(host => host.jumpHostId)).toBe(false);
  });
});
