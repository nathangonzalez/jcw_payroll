#!/usr/bin/env bash
set -euo pipefail

# Hardens Caddy service startup/recovery behavior on the VM.
# Safe to run multiple times.

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/harden_caddy_service.sh"
  exit 1
fi

OVERRIDE_DIR="/etc/systemd/system/caddy.service.d"
OVERRIDE_FILE="${OVERRIDE_DIR}/override.conf"

mkdir -p "${OVERRIDE_DIR}"

cat > "${OVERRIDE_FILE}" <<'EOF'
[Service]
Restart=on-failure
RestartSec=5s
TimeoutStartSec=3min
EOF

systemctl daemon-reload
systemctl restart caddy

echo "Caddy override applied at ${OVERRIDE_FILE}"
systemctl show caddy -p Restart -p RestartUSec -p TimeoutStartUSec
systemctl is-active caddy
