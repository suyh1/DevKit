#!/usr/bin/env bash
# The CI step supplies private mount, network and PID namespaces.
set -euo pipefail
node_bin=${1:?Node executable required}
ssh_user=${2:?Unprivileged SSH user required}
[[ $$ == 1 && $ssh_user != root ]] || { echo 'Run inside the test namespaces with an unprivileged SSH account.' >&2; exit 1; }
mkdir -p /run/netns /run/sshd
mount -t tmpfs tmpfs /run/netns
scratch=$(mktemp -d /run/devkit-relay.XXXXXXXX)
trap 'rm -rf -- "$scratch"' EXIT
chmod 711 "$scratch"
for role in A B C; do
  ip netns add "$role"
  ip -n "$role" link set lo up
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

mkdir "$scratch/files"
echo 'Single installation file transfer' > "$scratch/files/probe"
ssh-keygen -q -t ed25519 -N '' -f "$scratch/host"
ssh-keygen -q -t ed25519 -N '' -f "$scratch/client"
for role in A C; do
  ip netns exec "$role" /usr/sbin/sshd -f /dev/null -h "$scratch/host" -p 2222 \
    -o ListenAddress=0.0.0.0 -o "AllowUsers=$ssh_user" -o "AuthorizedKeysFile=$scratch/client.pub" \
    -o "PidFile=$scratch/sshd-$role.pid" -o GatewayPorts=clientspecified \
    -o UsePAM=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o 'Subsystem=sftp internal-sftp'
done
ip netns exec C /usr/bin/python3 -m http.server 8000 --directory "$scratch/files" > /dev/null 2>&1 &
ip netns exec C /usr/bin/python3 -m pyftpdlib -i 192.0.2.6 -p 2121 -r 50000-50004 -d "$scratch/files" > /dev/null 2>&1 &
for role in A B C; do
  echo "Testing DevKit installed only on $role"
  ip netns exec "$role" "$node_bin" scripts/relay-fixture.mjs "$role" "$scratch" "$ssh_user" &
  service_pid=$!
  for ((i=0; i<250; i++)); do
    [[ -e "$scratch/ready-$role" ]] && break
    kill -0 "$service_pid"
    sleep .2
  done
  test -e "$scratch/ready-$role"
  entry=192.0.2.1
  if [[ $role == B ]]; then entry=127.0.0.1; fi
  for url in "http://$entry:18080/probe" "ftp://$entry:12121/probe"; do
    ip netns exec B curl --noproxy '*' -fsS --max-time 10 "$url" | cmp - "$scratch/files/probe"
  done
  printf '[%s]:12222 %s\n' "$entry" "$(cat "$scratch/host.pub")" > "$scratch/known_hosts"
  options=(-i "$scratch/client" -o IdentitiesOnly=yes -o BatchMode=yes -o Port=12222 -o "UserKnownHostsFile=$scratch/known_hosts")
  ip netns exec B ssh "${options[@]}" "$ssh_user@$entry" 'echo SSH' | grep -qx SSH
  echo "get $scratch/files/probe $scratch/received" > "$scratch/batch"
  ip netns exec B sftp -b "$scratch/batch" "${options[@]}" "$ssh_user@$entry"
  cmp "$scratch/files/probe" "$scratch/received"
  kill "$service_pid"
  wait "$service_pid"
done
