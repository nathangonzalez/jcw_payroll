# Recovered requirements (extracted from recent work/session)

Summary of intended features and important behaviors to recover locally:

- Admin-only simulation: seeding/simulation actions must be available only in the `Admin` UI, not in the employee `app` UI.
- Remove inline "🌱 Seed Sample Weeks" text/button from employee UI; keep explicit admin simulate controls in `admin.html`.
- Auto-save / Draft: keep a client-side autosave/draft feature (localStorage) for partially-entered entries; include `saveDraft()`, `loadDraft()`, `clearDraft()` behavior.
- Employee flow: select employee, choose client (dropdown or free-text), pick date, enter hours, Save Draft, Submit Week, Load Week. Keep `find-or-create` for customers.
- Voice command helpers: optional voice recording and `applyParsed()` flow; guarded so it does nothing when UI elements absent.
- Export requirements:
  - Weekly export includes per-employee sheet and totals: add `hourlyAmount`, `adminAmount`, and `grand total` rows.
  - Monthly export includes `GRAND TOTAL` row on Monthly Breakdown sheet.
- Admin endpoints:
  - `POST /api/admin/clear-test-entries` and `POST /api/admin/clear-seeded-entries` to remove seeded/test data.
  - `POST /api/admin/cleanup-test-customers` (or similar) was requested to delete "API Test Customer%" records (dev only).
- Server behavior:
  - Use `NODE_ENV=production` behaviors only in production; in development avoid cloud restores and scheduled backups.
  - Secrets: load from Secret Manager in production; in dev use env vars.
- Deployment:
  - No-promote patch deploy workflow used earlier; document commands for safe patch testing before promotion.
- Misc fixes to recover:
  - Remove duplicated/corrupted `public/app.html` content (we restored deployed copy).
  - Preserve `serviceWorker` registration and PWA assets.
  - Ensure `api()` helper normalizes to `/api/...` paths in client code.

Notes for local recovery tasks:
- Start local server with `NODE_ENV=development` to skip `restoreFromCloud()` and other production-only actions.
- If migrations fail locally (FOREIGN KEY errors), do not drop DB without backup; inspect `lib/migrate.js` and `data/app.db`.
- Verify `/api/health`, `/api/employees`, `/api/customers`, and `/api/time-entries` endpoints locally.

Next steps (suggested):
1. Run local server (development) and confirm health endpoint.
2. Run through employee UI: select employee, create a draft entry, confirm autosave, submit week, verify DB entries.
3. Run admin simulate and generate a weekly export; download and inspect XLSX for new totals.
4. Triage and fix SMTP secret or email send if needed (not required for local dev).

If anything above is incomplete or you want a different recovery order, tell me which item to prioritize.
