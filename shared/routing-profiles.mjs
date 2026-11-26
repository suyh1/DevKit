// Resolve the hub first so both discovery and enrollment use the same saved management path.
export function routingProfiles(hosts, local, addresses, preferred = {}) {
  const trusted = hosts.filter(host => host.mode === 'ssh' && host.fingerprint);
  const profiles = {}, matching = {}, available = {};
  for (const device of ['A','B','C']) {
    const viaHub = local !== 'A' && device !== 'A';
    const options = device === local ? [] : viaHub
      ? trusted.filter(host => profiles.A && host.id !== profiles.A && host.jumpHostId === profiles.A)
      : trusted;
    available[device] = options;
    const matches = options.filter(host => addresses[device].includes(host.address));
    matching[device] = matches;
    const selected = options.find(host => host.id === preferred[device]) || (matches.length === 1 && matches[0]);
    if (selected) profiles[device] = selected.id;
  }
  return { profiles, matching, available };
}
