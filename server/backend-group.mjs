import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Legacy launch records contain wall-clock launch time and per-boot clock ticks.
export async function launchedThisBoot(identity) {
  const startedAt = Date.parse(identity.startedAt);
  if (!Number.isFinite(startedAt)) return false;
  if (process.platform === 'darwin') {
    const { stdout } = await execute('sysctl', ['-n', 'kern.boottime'], { timeout: 3000, maxBuffer: 16384 });
    const bootTime = stdout.match(/\bsec\s*=\s*(\d+)/)?.[1];
    return !!bootTime && startedAt >= Number(bootTime) * 1000;
  }
  const stat = await readFile('/proc/stat', 'utf8');
  const bootTime = stat.match(/^btime (\d+)$/m)?.[1];
  return !!bootTime && startedAt >= Number(bootTime) * 1000;
}

// backend-job starts the business entry as both session and process group leader.
export async function groupMembers(group) {
  if (!Number.isSafeInteger(group) || group <= 1) throw new Error('业务进程组标识无效。');
  try { process.kill(-group, 0); }
  catch (error) { if (error.code === 'ESRCH') return []; throw error; }
  const members = [];
  if (process.platform === 'darwin') {
    const { stdout } = await execute('ps', ['-axo', 'pid=,pgid=,stat=,lstart='], { timeout: 3500, maxBuffer: 512 * 1024, env: { ...process.env, LC_ALL: 'C' } });
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s*$/.exec(line);
      if (!match || Number(match[2]) !== group || match[3].startsWith('Z')) continue;
      const startMs = Date.parse(match[4]);
      if (Number.isFinite(startMs)) members.push({ pid: Number(match[1]), created: String(Math.floor(startMs / 1000)) });
    }
    return members;
  }
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let raw;
    try { raw = await readFile('/proc/' + name + '/stat', 'utf8'); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
    const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    if (+fields[2] === group && +fields[3] === group && !['Z', 'X'].includes(fields[0]))
      members.push({ pid: Number(name), created: fields[19] });
  }
  return members;
}

export function hasGroupWitness(identity, members) {
  const recorded = new Map((identity.stopWitnesses || []).map(member => [member.pid, member.created]));
  recorded.set(identity.business.pid, identity.business.created);
  return members.some(member => recorded.get(member.pid) === member.created);
}
