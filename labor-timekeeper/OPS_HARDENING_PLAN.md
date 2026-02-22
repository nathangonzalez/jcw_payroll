# Ops Hardening Plan (Safe Changes First)
# Created: 2026-02-17

## Objective
Maintain stability of the current production version (jcw10) while improving data durability and email reliability with low-risk, reversible steps.

## Guardrails (No-Risk Policy)
- Do not change production traffic without a staged deployment and explicit approval.
- All changes deploy with `--no-promote` and validated via staging URL before promotion.
- Rollback path always available (promote previous version).
- Avoid schema changes during payroll windows.

## Current Baseline
- Production traffic: jcw10 (App Engine, traffic_split=1.00).
- Current data is stable and formatting is correct.

## Safe Verification Checklist (Before Any Promotion)
- `GET /api/health` on staging shows non-zero `time_entries` and expected `customers` count.
- Backups are advancing (GCS object `app.db` last updated within 10 minutes).
- Submit-week email or admin email report succeeds on staging.
- No `[startup]` or `[email]` warnings in logs after cold start test.

## Ops Hardening Roadmap (Low Risk -> Higher Risk)
1. Documentation-only updates
   - Keep `VERSION_LINEAGE.md` and `persist.txt` current.
   - Add/maintain a release checklist in this file.
2. Observability (no behavior change)
   - Add a lightweight `/api/health` log snapshot to the deploy checklist.
   - Capture `backupToCloud` and `restoreFromCloud` metrics (counts + duration).
3. Safe behavior changes (require staging validation)
   - Improve backup guard so empty DBs never upload even when consistent copy fails.
   - Fix reconcile/archive range mismatch (payroll month vs calendar month).
   - Fix archive summary billed totals.

## Rollback Steps
- Use `safe-promote.ps1` to re-promote the last known-good version.
- Confirm `/api/health` and logs after rollback.
