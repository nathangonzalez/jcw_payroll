# Caddy Ops Runbook

## Why this matters

Labor Timekeeper can be healthy locally on `127.0.0.1:8080` while still down publicly if Caddy is not running.

## Symptoms

- Local health passes:
  - `curl http://127.0.0.1:8080/api/health`
- Public domain fails:
  - `curl https://payroll.jcwelton.com/api/health`

## Quick triage (on VM)

```bash
systemctl is-active caddy labor-timekeeper
sudo systemctl status caddy --no-pager -l
sudo journalctl -u caddy -n 100 --no-pager
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

## Recovery

```bash
sudo systemctl restart caddy
curl -sS https://payroll.jcwelton.com/api/health
```

## Hardening (one-time)

Apply and verify service restart behavior:

```bash
sudo bash scripts/harden_caddy_service.sh
```

Expected:
- `Restart=on-failure`
- `RestartSec=5s`
- `TimeoutStartSec=3min`
- `systemctl is-active caddy` returns `active`

## Why SSH was required

Caddy is a VM system service. Troubleshooting needed `systemctl`, `journalctl`, and writes to `/etc/systemd/system`, which are only available on the VM host with sudo.
