#!/usr/bin/env bash
# The CI step supplies private mount, network and PID namespaces.
set -euo pipefail
node_bin=${1:?Node executable required}
ssh_user=${2:?Unprivileged SSH user required}
[[ $$ == 1 && $ssh_user != root ]] || { echo 'Run inside the test namespaces with an unprivileged SSH account.' >&2; exit 1; }
mkdir -p /run/netns /run/sshd
mount -t tmpfs tmpfs /run/netns
scratch=$(mktemp -d /run/devkit-relay.XXXXXXXX)
mount -t tmpfs -o exec tmpfs "$scratch"
trap 'umount -l "$scratch"; rmdir "$scratch"' EXIT
cp /etc/hosts "$scratch/hosts"
printf '127.0.0.1 %s\n' "$(hostname)" >> "$scratch/hosts"
mount --bind "$scratch/hosts" /etc/hosts
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
ssh-keygen -q -t ed25519 -N '' -f "$scratch/client"
# Keep persistent configuration and the network-manager profile fixture private to the test.
mount -t tmpfs tmpfs /etc/sysctl.d
mount -t tmpfs tmpfs /etc/systemd/network
mkdir -p /run/dbus
mount -t tmpfs tmpfs /run/dbus
cat > "$scratch/networkctl" <<'PROFILE'
#!/bin/sh
echo 'Network File: /etc/systemd/network/10-fixture.network'
PROFILE
chmod 755 "$scratch/networkctl"
mount --bind "$scratch/networkctl" "$(command -v networkctl)"
ip netns exec B networkctl status --no-pager from-B | grep -q 'Network File: /etc/systemd/network/10-fixture.network'
for role in A B C; do
  ssh-keygen -q -t ed25519 -N '' -f "$scratch/host-$role"
  ip netns exec "$role" /usr/sbin/sshd -f /dev/null -h "$scratch/host-$role" -p 2222 \
    -o ListenAddress=0.0.0.0 -o "AllowUsers=$ssh_user" -o "AuthorizedKeysFile=$scratch/client.pub" \
    -o "PidFile=$scratch/sshd-$role.pid" -o GatewayPorts=clientspecified \
    -o UsePAM=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o 'Subsystem=sftp internal-sftp'
done
ip netns exec C /usr/bin/python3 -m http.server 8000 --directory "$scratch/files" > /dev/null 2>&1 &
ip netns exec C /usr/bin/python3 - "$scratch/files" <<'PY' &
import sys
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer

authorizer = DummyAuthorizer()
authorizer.add_anonymous(sys.argv[1])
FTPHandler.authorizer = authorizer
FTPHandler.passive_ports = range(50000, 50005)
FTPServer(("192.0.2.6", 2121), FTPHandler).serve_forever()
PY
for url in http://192.0.2.6:8000/probe ftp://192.0.2.6:2121/probe; do
  ip netns exec A curl --noproxy '*' --retry 5 --retry-connrefused --retry-delay 1 --max-time 10 -fsS "$url" | cmp - "$scratch/files/probe"
done
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
  printf '[%s]:12222 %s\n' "$entry" "$(cat "$scratch/host-C.pub")" > "$scratch/known_hosts"
  options=(-i "$scratch/client" -o IdentitiesOnly=yes -o BatchMode=yes -o Port=12222 -o "UserKnownHostsFile=$scratch/known_hosts")
  ip netns exec B ssh "${options[@]}" "$ssh_user@$entry" 'echo SSH' | grep -qx SSH
  echo "get $scratch/files/probe $scratch/received" > "$scratch/batch"
  ip netns exec B sftp -b "$scratch/batch" "${options[@]}" "$ssh_user@$entry"
  cmp "$scratch/files/probe" "$scratch/received"
  kill "$service_pid"
  wait "$service_pid"
done

for role in A B C; do
  echo "Applying bidirectional host routes with DevKit installed only on $role"
  for dev in to-B to-C; do ip netns exec A sysctl -qw "net/ipv4/conf/$dev/forwarding=0"; done
  if ip -n B route get 192.0.2.6 || ip -n C route get 192.0.2.2; then exit 1; fi
  ip netns exec "$role" "$node_bin" scripts/routing-fixture.mjs "$role" "$scratch" "$ssh_user"

  # Start previously unknown business ports after DevKit exits; both peers initiate via original addresses.
  for host in B C; do
    ip netns exec "$host" /usr/bin/python3 -m http.server 19081 --directory "$scratch/files" >/dev/null 2>&1 &
    if [[ $host == B ]]; then b_pid=$!; else c_pid=$!; fi
  done
  ip netns exec B curl --noproxy '*' --retry 4 --retry-connrefused -fsS --max-time 6 http://192.0.2.6:19081/probe | cmp - "$scratch/files/probe"
  ip netns exec C curl --noproxy '*' --retry 4 --retry-connrefused -fsS --max-time 6 http://192.0.2.2:19081/probe | cmp - "$scratch/files/probe"
  kill "$b_pid" "$c_pid"
  wait "$b_pid" || true
  wait "$c_pid" || true
  ip -n B route del 192.0.2.6/32 via 192.0.2.1
  ip -n C route del 192.0.2.2/32 via 192.0.2.5
  for ip in 192.0.2.1 192.0.2.5; do rm "/etc/sysctl.d/95-devkit-route-$ip.conf"; done
  for ip in 192.0.2.2 192.0.2.6; do rm "/etc/systemd/network/10-fixture.network.d/95-devkit-$ip.conf"; done
done
