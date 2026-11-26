import { describe, expect, it } from 'vitest';
import { parseHostCsv, parseSshHosts } from './lan-import';

describe('LAN host import', () => {
  it('maps quoted CSV cells and connection metadata without taking credentials', () => {
    const [host] = parseHostCsv('NAME,address,user,port,group,tags,pinned,nginx,password\n"Web, test",ssh.test,operator,2200,Test,web|nginx,1,true,ignored');
    expect(host).toMatchObject({ name: 'Web, test', address: 'ssh.test', user: 'operator', port: 2200, group: 'Test', tags: ['web', 'nginx'], pinned: true, modules: { jar: false, nginx: true } });
    expect(host).not.toHaveProperty('password');
    expect(() => parseHostCsv('name,Address,address\nTest,first,second')).toThrow('唯一');
  });

  it('uses each session protocol’s default port in CSV imports', () => {
    const rows = parseHostCsv('mode,address,port\nVNC,screen,\nrdp,desktop,\nsftp,files,2222');
    expect(rows.map(({ mode, port }) => [mode, port])).toEqual([['vnc', 5900], ['rdp', 3389], ['sftp', 2222]]);
  });

  it('imports terminal, FTP and serial connection settings', () => {
    expect(parseHostCsv('mode,address,terminalType,lineEnding\ntelnet,switch,vt100,cr')[0]).toMatchObject({ port: 23, terminalType: 'vt100', lineEnding: 'cr' });
    expect(parseHostCsv('mode,address,ftpSecurity,startDirectory\nftp,nas,implicit,/archive')[0]).toMatchObject({ port: 990, ftpSecurity: 'implicit', startDirectory: '/archive' });
    expect(parseHostCsv('mode,address,baudRate,dataBits,stopBits,parity,flowControl,lineEnding\nserial,COM3,9600,7,2,odd,software,lf')[0]).toMatchObject({
      port: 0, baudRate: 9600, dataBits: 7, stopBits: 2, parity: 'odd', flowControl: 'software', lineEnding: 'lf',
    });
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
