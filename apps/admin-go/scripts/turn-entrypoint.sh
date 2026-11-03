#!/bin/sh
set -eu
umask 077
# Values are server configuration, never client input. Prevent newlines/config injection nevertheless.
case "${DESKTOP_TURN_SECRET:-}" in ''|*[!a-zA-Z0-9_./+=-]*) exit 1 ;; esac
test "${#DESKTOP_TURN_SECRET}" -ge 32
case "${DESKTOP_TURN_REALM:-}" in ''|*[!a-zA-Z0-9.-]*) exit 1 ;; esac
case "${DESKTOP_TURN_PUBLIC_IP:-}" in ''|*[!0-9.]*) exit 1 ;; esac
if test -n "${DESKTOP_TURN_CONTROL_PASSWORD:-}"; then
  case "$DESKTOP_TURN_CONTROL_PASSWORD" in *[!a-zA-Z0-9_./+=-]*) exit 1 ;; esac
  test "${#DESKTOP_TURN_CONTROL_PASSWORD}" -ge 32
  test "$DESKTOP_TURN_CONTROL_PASSWORD" != "$DESKTOP_TURN_SECRET"
fi
# This file is an atomic restart snapshot, maintained from the admin database.
# A missing snapshot is a legacy install; an invalid snapshot must fail closed.
total_quota=256
quota_file=/var/lib/codex-switch/turn-quota/total-quota
if test -e "$quota_file"; then
  total_quota=$(cat "$quota_file")
  case "$total_quota" in ''|*[!0-9]*) exit 1 ;; esac
  test "${#total_quota}" -le 5
  test "$total_quota" -ge 1 && test "$total_quota" -le 65535
fi
# A concrete local address lets coturn route two allocations on this server internally.
# Advertising only the public IP would require the cloud NAT to support hairpin traffic.
relay_ip=$(hostname -i)
case "$relay_ip" in ''|*[!0-9.]*) exit 1 ;; esac
cat > /tmp/codex-turn.conf <<EOF
listening-port=3478
listening-ip=0.0.0.0
relay-ip=${relay_ip}
external-ip=${DESKTOP_TURN_PUBLIC_IP}/${relay_ip}
realm=${DESKTOP_TURN_REALM}
use-auth-secret
static-auth-secret=${DESKTOP_TURN_SECRET}
fingerprint
min-port=50000
max-port=50199
user-quota=8
total-quota=${total_quota}
no-dynamic-realms
max-bps=4194304
max-allocate-lifetime=600
no-tls
no-tcp-relay
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
pidfile=/tmp/codex-turn.pid
log-file=stdout
simple-log
EOF
# Legacy containers without the new environment keep working with CLI disabled.
# Management is available only inside the private relay network, never published.
if test -n "${DESKTOP_TURN_CONTROL_PASSWORD:-}"; then
  cat >> /tmp/codex-turn.conf <<EOF
cli
cli-ip=0.0.0.0
cli-port=5766
cli-password=${DESKTOP_TURN_CONTROL_PASSWORD}
EOF
fi
exec turnserver -c /tmp/codex-turn.conf "$@"
