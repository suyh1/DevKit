import { readFile, readdir } from 'node:fs/promises';

// Legacy launch records contain wall-clock launch time and per-boot clock ticks.
export async function launchedThisBoot(identity) {
  const startedAt = Date.parse(identity.startedAt);
  if (!Number.isFinite(startedAt)) return false;
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
