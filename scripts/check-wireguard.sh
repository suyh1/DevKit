#!/usr/bin/env bash
# The CI step supplies private mount, network and PID namespaces.
set -euo pipefail
node_bin=${1:?Node executable required}
ssh_user=${2:?Unprivileged SSH user required}
[[ $$ == 1 && $ssh_user != root ]] || { echo 'Run inside the test namespaces with an unprivileged SSH account.' >&2; exit 1; }
mkdir -p /run/netns /etc/wireguard /run/sshd
mount -t tmpfs tmpfs /run/netns
mount -t tmpfs -o mode=755 tmpfs /etc/wireguard
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
chmod 711 "$scratch"
export WG_FIXTURE="$scratch"
for role in A B C; do
  ip netns add "$role"
  ip -n "$role" link set lo up
  (umask 077; wg genkey > "/etc/wireguard/devkit-${role,,}.key")
  wg pubkey < "/etc/wireguard/devkit-${role,,}.key" > "$scratch/$role.pub"
done

link_to_hub() {
  local role=$1 hub_ip=$2 peer_ip=$3
  ip link add "to-$role" type veth peer name "from-$role"
  ip link set "to-$role" netns A
  ip link set "from-$role" netns "$role"
  ip -n A addr add "$hub_ip/30" dev "to-$role"
  ip -n "$role" addr add "$peer_ip/30" dev "from-$role"
  ip -n A link set "to-$role" up
  ip -n "$role" link set "from-$role" up
}
link_to_hub B 192.0.2.1 192.0.2.2
link_to_hub C 192.0.2.5 192.0.2.6
if ip -n B route get 192.0.2.6 || ip -n C route get 192.0.2.2; then exit 1; fi

"$node_bin" --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { createCollabStore } from './server/collab-store.mjs';
const store = await createCollabStore(process.env.WG_FIXTURE);
try {
  for (const device of await store.request('wireguard', 'list')) {
    const publicKey = (await readFile(process.env.WG_FIXTURE + '/' + device.role + '.pub', 'utf8')).trim();
    const endpoint = device.role === 'B' ? '192.0.2.1:51820' : '192.0.2.5:51820';
    await store.request('wireguard', 'save', { ...device, publicKey, endpoint });
  }
  for (const node of await store.request('wireguard', 'list'))
    await writeFile('/etc/wireguard/devkit-' + node.role.toLowerCase() + '.conf', node.linuxConfig, { mode: 0o600 });
} finally { await store.close(); }
NODE

for role in A B C; do ip netns exec "$role" wg-quick up "devkit-${role,,}"; done
mkdir "$scratch/files"
echo 'WireGuard transfer check' > "$scratch/files/probe"
for role in B C; do
  ip netns exec "$role" /usr/bin/python3 -m http.server 8000 --directory "$scratch/files" > /dev/null 2>&1 &
done
fetch_file() {
  ip netns exec "$1" curl --noproxy '*' -fsS --connect-timeout 2 --max-time 5 --retry 4 --retry-all-errors "$2" | cmp - "$scratch/files/probe"
}
fetch_file B http://10.77.0.3:8000/probe
fetch_file C http://10.77.0.2:8000/probe
ip netns exec C /usr/bin/python3 -m pyftpdlib -i 10.77.0.3 -p 2121 -d "$scratch/files" > /dev/null 2>&1 &
fetch_file B ftp://10.77.0.3:2121/probe

ssh-keygen -q -t ed25519 -N '' -f "$scratch/host"
ssh-keygen -q -t ed25519 -N '' -f "$scratch/client"
install -m 644 "$scratch/client.pub" /etc/wireguard/ci-authorized-keys
ip netns exec C /usr/sbin/sshd -f /dev/null -h "$scratch/host" -p 2222 \
  -o ListenAddress=10.77.0.3 -o "AllowUsers=$ssh_user" -o AuthorizedKeysFile=/etc/wireguard/ci-authorized-keys \
  -o UsePAM=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o 'Subsystem=sftp internal-sftp'
printf '[10.77.0.3]:2222 %s\n' "$(cat "$scratch/host.pub")" > "$scratch/known_hosts"
options=(-i "$scratch/client" -o IdentitiesOnly=yes -o BatchMode=yes -o Port=2222 -o "UserKnownHostsFile=$scratch/known_hosts")
ip netns exec B ssh "${options[@]}" "$ssh_user@10.77.0.3" 'echo SSH' | grep -qx SSH
echo "get $scratch/files/probe $scratch/received" > "$scratch/batch"
ip netns exec B sftp -b "$scratch/batch" "${options[@]}" "$ssh_user@10.77.0.3"
cmp "$scratch/files/probe" "$scratch/received"
