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

# A can already route to LAN hosts behind B and C. Two more clients reach A across a router.
leaf() {
  local name=$1 router=$2 gw=$3 ip=$4
  ip netns add "$name"
  ip link add "to-$name" type veth peer name "in-$name"
  ip link set "to-$name" netns "$router"
  ip link set "in-$name" netns "$name"
  ip -n "$router" addr add "$gw/24" dev "to-$name"
  ip -n "$router" link set "to-$name" up
  ip -n "$name" addr add "$ip/24" dev "in-$name"
  ip -n "$name" link set "in-$name" up
  ip -n "$name" link set lo up
  ip -n "$name" route add default via "$gw"
}
leaf LB B 198.51.100.1 198.51.100.42
leaf LC C 203.0.113.1 203.0.113.42
leaf TB B 172.25.11.1 172.25.11.2
leaf TC C 172.25.12.1 172.25.12.2
ip -n A route add 198.51.100.0/24 via 192.0.2.2
ip -n A route add 203.0.113.0/24 via 192.0.2.6
ip -n A route add 172.25.11.0/24 via 192.0.2.2
ip -n A route add 172.25.12.0/24 via 192.0.2.6
for router in B C; do ip netns exec "$router" sysctl -qw net.ipv4.ip_forward=1; done
ip netns exec A "$node_bin" scripts/gateway-fixture.mjs "$scratch"
for host in LB LC; do
  ip netns exec "$host" /usr/bin/python3 -m http.server 18084 --directory "$scratch/files" >/dev/null 2>&1 &
done
udp_echo() {
  ip netns exec "$1" /usr/bin/python3 -c '
import pathlib, socket, sys
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.bind((sys.argv[1],18085))
pathlib.Path(sys.argv[2]).touch()
while True:
 data, addr=s.recvfrom(1024); s.sendto(data,addr)' "$2" "$scratch/udp-$2" &
  local pid=$!
  for ((i=0; i<50; i++)); do
    [[ -e "$scratch/udp-$2" ]] && return
    kill -0 "$pid" || return 1
    sleep .1
  done
  return 1
}
udp_echo LB 198.51.100.42
udp_echo LC 203.0.113.42
service_check() {
  ip netns exec "$1" curl --noproxy '*' --retry 2 --retry-connrefused --max-time 5 -fsS "http://$2:18084/probe" | cmp - "$scratch/files/probe"
  ip netns exec "$1" /usr/bin/python3 -c '
import socket, sys
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(3)
s.connect((sys.argv[1],18085)); s.send(b"subnet"); assert s.recv(64)==b"subnet"' "$2"
}
ip netns exec A sh "$scratch/direct/A/forward.sh"
for pass in 1 2; do
  ip netns exec B sh "$scratch/direct/via-192.0.2.1/routes.sh"
  ip netns exec C sh "$scratch/direct/via-192.0.2.5/routes.sh"
done
service_check B 203.0.113.42
service_check C 198.51.100.42
service_check LB 203.0.113.42
service_check LC 198.51.100.42
for prefix in 192.0.2.4/30 203.0.113.0/24 172.25.12.0/24; do ip -n B route del "$prefix" via 192.0.2.1; done
for prefix in 192.0.2.0/30 198.51.100.0/24 172.25.11.0/24; do ip -n C route del "$prefix" via 192.0.2.5; done
ip -n C route add 192.0.2.1/32 via 192.0.2.5
if ip -n B route get 203.0.113.42 || ip -n C route get 198.51.100.42; then exit 1; fi
ip netns exec A wg-quick up "$scratch/tunnel/A/devkit-a.conf"
ip netns exec A sh "$scratch/tunnel/A/forward.sh"
ip netns exec TB sh "$scratch/tunnel/B/prepare.sh"
ip netns exec TC sh "$scratch/tunnel/C/prepare.sh"
ip netns exec TB wg-quick up "$scratch/tunnel/B/ready/devkit-b.conf"
ip netns exec TC wg-quick up "$scratch/tunnel/C/ready/devkit-c.conf"
service_check TB 203.0.113.42
service_check TC 198.51.100.42

# Re-prepare active clients. Their own tunnel must not count as a colliding LAN.
ip netns exec TB sh "$scratch/tunnel/B/prepare.sh"
ip netns exec TC sh "$scratch/tunnel/C/prepare.sh"
# Put a smaller destination inside B's native LAN. A reaches it through C,
# and C relies on a broader route to LC. Sending C back to A would loop.
ip -n A addr add 172.16.0.10/12 dev to-B
ip -n B addr add 172.16.0.2/12 dev from-B
ip -n LC addr add 172.20.0.42/32 dev lo
udp_echo LC 172.20.0.42
ip -n C route add 172.20.0.0/15 via 203.0.113.42
ip -n C route add 172.16.0.0/12 via 192.0.2.5
ip -n C route add 192.0.2.0/30 via 192.0.2.5
ip -n A route add 172.20.0.0/16 via 192.0.2.6
ip netns exec A "$node_bin" scripts/gateway-fixture.mjs "$scratch/recheck" 172.20.0.0/16
cmp <(grep '^Address =' "$scratch/tunnel/A/devkit-a.conf") <(grep '^Address =' "$scratch/recheck/tunnel/A/devkit-a.conf")
ip netns exec A sh "$scratch/recheck/tunnel/A/forward.sh"
ip netns exec B sh "$scratch/recheck/direct/via-172.16.0.10/routes.sh"
ip netns exec C sh "$scratch/recheck/direct/via-192.0.2.5/routes.sh"
ip -n B route get 172.20.0.42 | grep -q 'via 172.16.0.10'
test -z "$(ip -n C route show exact 172.20.0.0/16)"
service_check B 172.20.0.42
