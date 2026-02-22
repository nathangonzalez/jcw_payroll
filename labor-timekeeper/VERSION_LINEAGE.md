# Labor Timekeeper - Deployed Version Lineage

This file documents the deployed App Engine versions and the exact git commits they were built from.
Source: App Engine `source-context.json` for each version.

## Version Map (Production)
- jcw6 (deployed 2026-02-12 11:46:50 -05:00) -> 332604c6bc31a5ea6cce0060745e7724828552b4
  - Notes: export formatting tweaks (auto-fit column widths, wrap Notes)
- jcw7 (deployed 2026-02-12 13:14:31 -05:00) -> 332604c6bc31a5ea6cce0060745e7724828552b4
  - Notes: same commit as jcw6; no code difference
- jcw8 (deployed 2026-02-13 12:33:50 -05:00) -> 156dc7a001fb53efda2513cdf0341ccc540c74eb
  - Notes: email retry logic for Gmail 421 rate limiting
- jcw10 (deployed 2026-02-13 13:53:12 -05:00, traffic=1.00) -> 6311646d02122bc45e459aa968e56444b355a77f
  - Notes: hardened cold-start restore (retry + snapshot fallback + verification)

## Key Diffs By Version

### jcw6 -> jcw8
- Email: retry with exponential backoff; fresh SMTP connection per attempt.
- Storage: safety guard prevents uploading empty DBs.
- Restore-latest-merge: `INSERT OR IGNORE` for employees to avoid duplicates.

### jcw8 -> jcw10
- Storage: verifies restores; skips empty snapshots.
- Startup: retry loop + daily snapshot fallback; post-open DB sanity check.

## Current Objective: Hardening (DB + Ops + Email)
Priority areas based on code review:
1. Reconcile/archive range mismatch (payroll month vs calendar month).
2. Backup safety guard bypass if consistent copy fails.
3. Archive summary billed total uses missing columns.
4. Log encoding cleanup (mojibake in startup logs).
5. Email: validate secrets on startup; improve observability (metrics/alerts).
