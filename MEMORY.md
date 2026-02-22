# MEMORY.md — Long-Term Memory
# Last consolidated: 2026-02-22

> This is the curated long-term memory for the JCW Payroll workspace.
> Daily raw logs live in `memory/YYYY-MM-DD.md`. This file is the distilled reference.
> Previously tracked in `labor-timekeeper/persist.txt` (now deprecated in favor of this file).

---

## Project Overview

**JCW Labor Timekeeper** — Construction crew time tracking PWA with voice input and payroll export.

- Employee time entry with voice notes (OpenAI Whisper)
- Admin approval workflow (PIN: 7707)
- Weekly and Monthly XLSX payroll exports
- Cloud backup to Google Cloud Storage every 5 min
- Email notifications on submit/export (via smtp-relay.gmail.com)

---

## Production Deployment

| Field | Value |
|-------|-------|
| **URL** | https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com |
| **Version** | jcw13 (deployed 2026-02-22, TRAFFIC_SPLIT=1.00) |
| **Project** | jcw-2-android-estimator |
| **Region** | us-central1 |
| **Runtime** | nodejs22 on App Engine Standard (F1) |
| **Database** | SQLite at /tmp/app.db (ephemeral, restored from GCS on cold start) |
| **Bucket** | gs://jcw-labor-timekeeper |
| **Scaling** | min_instances=1, max_instances=1 |

---

## Current Data State (as of 2/22/2026)

- **285 time entries** (real production data weeks 1/28 through 2/22)
- **93 customers** (from seed + reconciliation additions)
- **8 employees:** Boban Abbate, Doug Kinsey, Jason Green, Phil Henderson, Sean Matthew, Thomas Brinson, Chris Jacobi (admin), Chris Zavesky (admin)
- GCS backup verified: 285 entries, 93 customers

---

## Key API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/time-entries` | POST | Create/update time entry |
| `/api/time-entries/:id` | DELETE | Delete entry (admin: `?force=true`, no employee_id needed) |
| `/api/submit-week` | POST | Submit week (DRAFT → SUBMITTED) |
| `/api/approvals?week_start=YYYY-MM-DD` | GET | Get pending entries |
| `/api/admin/all-entries?week_start=YYYY-MM-DD` | GET | Get ALL entries (any status) |
| `/api/approve` | POST | Approve entries `{ids: [...]}` |
| `/api/admin/force-backup` | POST | Trigger immediate GCS backup |
| `/api/admin/restore-latest-merge` | POST | Restore from GCS (merge into running DB) |
| `/api/health` | GET | Health check with DB stats |

---

## Deploy Workflow

```powershell
cd c:\Users\natha\dev\repos\jcw_payroll\labor-timekeeper

# Deploy new version WITHOUT promoting (safe):
gcloud app deploy --no-promote --version=jcwN --quiet

# Promote:
gcloud app deploy --version=jcwN --promote --quiet

# After promotion, restore data:
curl.exe -s -X POST "https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com/api/admin/restore-latest-merge" -d "{}"

# Force backup:
curl.exe -s -X POST "https://...appspot.com/api/admin/force-backup" -H "Content-Type: application/json" -d "{}"
```

**Critical**: Every deploy requires `restore-latest-merge` after promotion. The `restore-latest` endpoint doesn't work on cold start (daily snapshots have 0 entries).

---

## Slack Bot (Clawdbot)

| Field | Value |
|-------|-------|
| **App** | jcw_service |
| **Channel** | #jcw_bot (C0AFSUEJ2KY) |
| **User** | U0AFUDCUPUJ (Nathan) |
| **Secrets** | agent-ops/Slack/sc_manager.txt |
| **Start script** | agent-ops/scripts/run_slack_bot.ps1 |
| **VM service** | clawbot.service on clawbot-ops |
| **Scopes** | chat:write, app_mentions:read, im:history, assistant:write, commands, channels:history, groups:history |

### Status (2/22/2026)
- `/claw` slash command: ✅ working
- Channel messages: ✅ working
- DMs: ✅ enabled
- Interactive buttons (Approve/Reject): ⚠️ unreliable — NoneType errors on some paths
- Bot process dies between restarts — needs scheduled task

---

## Known Issues

1. `restore-latest` endpoint doesn't work on cold start (daily snapshots have 0 entries) — use `restore-latest-merge` instead
2. Slack bot approval buttons sometimes produce NoneType errors
3. Bot process dies on machine restart — no scheduled task configured
4. Missing Slack scopes: `im:write` (for DM cards), `users:read` (for user lookup)

---

## Backlog / Next Up

- [ ] Fix Slack approval button NoneType error completely
- [ ] Add payroll-specific Slack commands (`payroll:` prefix)
- [ ] Set up scheduled task for bot auto-restart
- [ ] Continue reconciliation work (Week 1-3 vs PDF source of truth)
- [ ] Timesheet formatting fixes (borders, spacing, alignment)
- [ ] Billing module logic parity story
- [ ] Suite shell development
- [ ] Fix startup restore to use merge approach by default

---

## Lessons Learned

- SQLite on App Engine is ephemeral — always back up to GCS, always restore after deploy
- `restore-latest-merge` is the only reliable restore method
- Admin delete needed `?force=true` bypass — employee ownership check was blocking admin operations
- Slack Socket Mode button clicks need careful scope configuration
- persist.txt and MEMORY.md were redundant — consolidated on 2/22/2026