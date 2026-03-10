# JCW Labor Timekeeper — Sprint Plan & User Stories

## Sprint 1: Data Integrity & Export Fix (Complete — Week 2 Pilot)
**Goal:** Reconcile Week 2/4 data against manual timesheets, fix export bugs

### US-1.1 ✅ Reconcile 2/4 Week Data Against Manual Timesheets
- Compare system entries vs. hand-written XLS files in `2_4/` folder
- Identify missing entries, hour mismatches, duplicate entries
- Load reconciled entries (25 new + corrections) into prod DB
- **Acceptance:** All 6 employees' hours match manual sheets for week of 2/4

### US-1.2 ✅ Fix Doug Kinsey PTO Duplicate
- Doug had 2 JCW "PTO" entries (4.5h + 3.5h) on 2/6 PLUS a correct 8h PTO entry
- Delete the 2 JCW duplicates, keep the 8h PTO entry
- **Acceptance:** Doug's 2/6 shows exactly 8h PTO, no JCW PTO entries

### US-1.3 ✅ Fix Lunch Column "1899-12-30" Display Bug
- Lunch hours written as Excel time serial (÷24) even when no explicit start/end times
- Fix: write lunch as plain number when no time data available; keep time serial when explicit times exist
- Applied to both `generateWeekly.js` and `generateMonthly.js`
- **Acceptance:** Lunch column shows "0.5" (not "1899-12-30") for entries without times

### US-1.4 ✅ Approve All DRAFT Entries
- 25 reconciled entries loaded as DRAFT, plus 2 remaining DRAFTs from prior import
- Approve all via API and DB fix
- **Acceptance:** Zero DRAFT entries in prod; all entries APPROVED

---

## Sprint 2: Timesheet Format & UX (Complete — Week 3 Pilot)
**Goal:** Improve employee timesheets for print-ready single-page output; add week navigation

### US-2.1 ✅ Employee Name on Every Timesheet
- Each timesheet tab/section prominently displays the employee's full name
- Title row: `Name — Date Range` (bold, size 14)
- Right panel also shows employee name (bold, size 12)
- **Acceptance:** When printed, employee name is clearly visible on every page

### US-2.2 ✅ Print-Ready Single Page Formatting
- Timesheets fit on a single landscape page when printed
- `fitToPage: true`, `fitToWidth: 1`, `fitToHeight: 1` in page setup
- Margins: 0.25" left/right, 0.5" top/bottom
- **Acceptance:** File → Print produces clean single-page output in Excel

### US-2.3 ✅ Consolidated Single-Tab Export (Stacked Weeks)
- Instead of one tab per employee per week, all weeks stacked on ONE sheet per employee
- Current week at the top, older weeks below with 4 blank separator rows
- Monthly breakdown and weekly summary sheets remain as separate tabs
- **Acceptance:** Export has ~8 employee sheets (not 16+), each with weeks stacked

### US-2.4 ✅ Week Selector in Employee UI
- Employees can select which payroll week to view/enter time for
- Dropdown shows all weeks in the current payroll month (4-5 weeks)
- Current week is pre-selected with "(current)" label
- API: `GET /api/payroll-weeks` returns weeks for the month
- **Acceptance:** Employee can navigate to previous weeks and enter late time entries

### US-2.5 ✅ Muncey Timesheet Verification
- "Muncey" is a **customer** (not an employee)
- Verified entries in system match the XLSX export:
  - **Jason Green** → 2026-02-06 → Muncey → **4h**
  - **Chris Zavesky** → 2026-02-04 → Muncey → **2.5h**
- Both entries are APPROVED and present in the production database
- **Acceptance:** Muncey customer hours match manual records ✅
- **Note:** Need physical hard copy verification for final sign-off

---

## Sprint 2.5: Data Recovery & Backup Hardening (Hotfix — 2/12/2026)
**Goal:** Recover from data loss incident caused by empty DB overwriting GCS backup

### US-2.5.1 ✅ Root Cause Analysis
- **Cause:** App Engine instance cold-start created empty DB, then `backupToCloud()` overwrote good GCS backup with empty DB
- **Impact:** All 143+ time entries lost from production
- **Timeline:** Occurred during jcw6 deployment on 2/12/2026

### US-2.5.2 ✅ Backup Safety Guard
- Added row-count check to `backupToCloud()` in `lib/storage.js`
- Refuses to upload DB with fewer rows than what's already in GCS
- Logs warning: `[backupToCloud] Refusing to upload smaller DB`
- **Acceptance:** Empty DB can never overwrite populated GCS backup

### US-2.5.3 ✅ Fix Merge Endpoint (INSERT OR IGNORE)
- `restore-latest-merge` endpoint failed silently when employee IDs collided
- Changed employees INSERT to `INSERT OR IGNORE` to handle pre-existing rows
- **Acceptance:** Merge restore works without FK constraint errors

### US-2.5.4 ✅ Data Recovery from XLSX Export
- Built `scripts/import_from_xlsx.mjs` parser using ExcelJS
- Extracted 131 work entries from the last good XLSX export
- Created 6 missing customers (Turbergen, Office, PTO, doctor, Brooke, mulvoy)
- Added 12 lunch entries from 2/8 GCS backup
- **Final count:** 143 entries restored (131 work + 12 lunch), all APPROVED
- **Acceptance:** Production DB has 143 entries, 89 customers, 8 employees

### US-2.5.5 ✅ Deploy jcw7 with Fixes
- Deployed version jcw7 with backup safety guard + merge fix
- Safe-promoted to production traffic
- **Acceptance:** `/api/health` returns 143 entries, all systems operational

---

## Sprint 2.6: Cold-Start Restore Hardening (Hotfix — 2/13/2026)
**Goal:** Fix persistent cold-start data loss caused by WAL-mode backup bug

### US-2.6.1 ✅ Root Cause Analysis — WAL Not Checkpointed
- jcw6 ran SQLite in WAL mode; all writes stored in `-wal` sidecar file
- `backupToCloud()` uploaded raw `.db` file (without WAL data) → empty backup
- The `__EMPTY__` guard in jcw8 prevented empty backups, but GCS was already corrupted
- Daily snapshots were also empty (uploaded from empty instances)
- **Impact:** All restore attempts downloaded a 127KB file with schema but 0 entries/0 customers

### US-2.6.2 ✅ Hardened Cold-Start Restore (Retry + Snapshot Fallback)
- **Layer 1:** 3 retries with 2s backoff for main GCS backup download
- **Layer 2:** If main backup has 0 entries, fall back to daily snapshots (tries 5 most recent)
- **Verification gate:** `verifyDbEntries()` checks entry count after every download
- **Empty guard:** Refuses to start backup schedule if DB has 0 entries
- New exports: `restoreFromDailySnapshot()`, `verifyDbEntries()` in `lib/storage.js`
- **Acceptance:** Server logs show retry attempts and fallback behavior

### US-2.6.3 ✅ Emergency Data Migration (jcw6 → jcw10)
- Extracted all 151 entries from running jcw6 instance via REST API
- Created 6 missing customers (mulvoy, Turbergen, PTO, Office, doctor, Brooke)
- Imported all 151 entries into jcw10 staging
- `createConsistentCopy()` (VACUUM INTO) now properly captures WAL data in backup
- **Acceptance:** jcw10 has 151 entries, 89 customers, 8 employees — matches jcw6

### US-2.6.4 ✅ Deploy jcw10 & Promote
- Deployed jcw10 with hardened restore (retry + snapshot fallback + verification)
- Verified GCS backup updated with real data (86KB, not empty 127KB)
- Safe-promoted jcw10 to production
- **Acceptance:** `/api/health` returns 151 entries, cold-starts will now retry + fallback

---

## Sprint 3: Formula Cascade & Monthly Accuracy
**Goal:** Ensure all cross-sheet formulas calculate correctly

### US-3.1 🔲 Fix Monthly Breakdown Formula References
- Monthly Breakdown sheet SUMIF formulas must reference correct row ranges on stacked employee sheets
- Verify all hourly and admin employee totals cascade correctly
- **Acceptance:** Every cell in Monthly Breakdown shows correct calculated value

### US-3.2 🔲 OT Premium Auto-Calculation
- OT Premium section on weekly sheets must use formula: `MAX(0, employee_total - 40)`
- Reference employee timesheet TOTAL row for live cascade
- **Acceptance:** Editing hours on employee sheet auto-updates OT on weekly sheet

### US-3.3 🔲 Email Delivery Verification
- Monthly export email must arrive with XLSX attachment
- Test with `sendEmail=true` parameter
- Verify recipient list, subject line, and attachment name
- **Acceptance:** Email received with correct Payroll_Breakdown_2026-02.xlsx

---

## Sprint 4: Production Hardening
**Goal:** Stabilize for ongoing weekly use

### US-4.1 🔲 Automated Weekly Export Cron
- Set up App Engine cron job to auto-export every Tuesday (end of payroll week)
- Email results to payroll administrator
- **Acceptance:** Export runs automatically each week without manual trigger

### US-4.2 ✅ Data Backup & Recovery (Hardened in Sprint 2.5)
- GCS backup on every DB change (already implemented)
- Restore-from-backup admin endpoint (already implemented)
- **NEW:** Safety guard prevents empty DB from overwriting good backups
- **NEW:** XLSX import script for disaster recovery (`scripts/import_from_xlsx.mjs`)
- Add backup rotation (keep last 30 days)
- **Acceptance:** Can restore any backup from the last 30 days

### US-4.3 🔲 Duplicate Entry Prevention
- Prevent submitting same employee/customer/date/hours combination twice
- Show warning in UI if potential duplicate detected
- **Acceptance:** Duplicate submissions are blocked with clear error message

### US-4.4 🔲 Excel Export Layout Cleanup + Pretty Print Parity
- Remove dead/blank spacer rows in weekly and monthly XLSX exports that create unnecessary white space when printed.
- Normalize row heights, borders, and table spacing so sheets are compact and readable.
- Align visual hierarchy with HTML print view:
  - clear section header
  - consistent day subtotal rows
  - strong grand total row
  - readable summary panel formatting
- Ensure formulas and totals still calculate after layout changes.
- **Acceptance:** Exported XLSX prints without large empty blocks and visually matches the HTML print report structure.

---

## Sprint 5: Payroll Model Decoupling + Formula Integrity
**Goal:** Decouple admin salary flows from weekly payroll exports and guarantee formula correctness.

### US-5.1 ?? Decouple Admin From Weekly Payroll Export
- Exclude admin employees from weekly crew payroll calculations by default.
- Remove include-admin controls from weekly payroll UI to prevent accidental payroll mixing.
- Keep admin records in database and monthly admin replacement workflow, but outside weekly payroll totals.
- **Acceptance:** Weekly payroll totals never include Chris Jacobi/Chris Zavesky, and weekly print UI has no include-admin toggle.

### US-5.2 ?? Separate Admin Monthly Payroll Sheet (Template Match)
- Create a dedicated admin monthly sheet layout that mimics `Admin_Monthly_Payroll (Feb) - r1.xlsx`.
- Replace per-employee weekly workbook outputs with one consolidated workbook layout:
  - tabs labeled by payroll week (`Week 1`, `Week 2`, ... or `Week of <date>`)
  - one dedicated `Admin` tab for Chris Jacobi + Chris Zavesky
  - no individual employee tabs for weekly review.
- Keep weekly crew payroll sheets independent from admin monthly salary sheet.
- Ensure admin sheet can be generated without touching weekly payroll formulas.
- Add dedicated endpoint `GET /api/export/monthly-admin?month=YYYY-MM`.
- **Acceptance:** Monthly workbook contains distinct tabs/sections for Crew Weekly and Admin Monthly with no cross-coupling.

### US-5.3 ?? Formula Guardrail Test Suite
- Add automated checks for every critical formula column (hours, regular/OT, OT premium, totals, monthly rollups).
- Validate formula references after row insert/delete and spacer cleanup.
- Fail generation if broken formulas or `#REF!`/`#VALUE!` are detected.
- **Acceptance:** Export pipeline blocks broken workbooks and reports exact sheet/cell failures.

### US-5.4 ?? Remove Dead Space In XLSX + Pretty Print Pass
- Implement row compaction to remove dead blank blocks in weekly and admin sheets.
- Align print area, page breaks, and table styling to mirror HTML pretty print (single review pack style).
- Preserve comments/notes columns while compacting spacing.
- **Acceptance:** Printed XLSX uses compact pages with no large empty gaps and legible formatting.

### US-5.5 ?? Admin Delete + Week Selection Reliability
- Harden admin delete flow so force-delete never depends on employee_id.
- Improve admin week default to latest non-empty payroll week when current week is empty.
- **Acceptance:** Admin can delete approved entries reliably and All Entries opens on a non-empty week when available.

### US-5.6 ?? Slack Proof-Of-Work And Approval Traceability
- Post one concise Slack summary per run: active workers, completed spikes, blockers, and queue depth.
- Include evidence pointers (artifact id, commit hash/branch when code exists).
- Split proposal approval from implementation approval to avoid blind approvals.
- **Acceptance:** Slack channel shows actionable status only; each approval maps to auditable output.

### US-5.7 ?? Admin Billing Defaults From Reference Artifact
- Parse the reference workbook (`Admin_Monthly_Payroll (Feb) - r1.xlsx`) and lock admin billing defaults.
- Set `client_bill_rate` defaults for Chris Jacobi and Chris Zavesky to the artifact value.
- Keep these rates billing-only; do not reintroduce admin salary rows into weekly crew payroll totals.
- **Acceptance:** Billing report uses $100 client rate for both Chris entries; weekly payroll remains admin-excluded by default.

### US-5.8 ?? Customer List Cleanup (Admin Request - Emily)
- Normalize duplicate Tubergen spellings to one canonical customer record.
- Remove standalone `Office` and `JCW` from the employee app customer options.
- Add a single consolidated option: `JCW, Office, Shop`.
- Migrate/merge historical entries so reporting rolls up under canonical names (no split totals from spelling variants).
- Keep an admin-safe mapping/alias layer so legacy imports with old names still resolve correctly.
- **Acceptance:** App dropdown shows one Tubergen entry and one `JCW, Office, Shop` option; payroll/billing exports aggregate correctly without duplicate customer lines.

### US-5.9 ?? Voice Coding Spike: Aider + `--voice`
- Install and configure Aider for this repo with voice mode enabled.
- Validate end-to-end flow:
  - mic input -> Whisper transcription -> LLM coding action -> file change in repo.
- Add runbook for daily use (recommended flags, model settings, safe usage boundaries).
- Add a short UAT demo script showing one spoken coding task from prompt to diff.
- **Acceptance:** Nate can complete one real code edit via voice-only interaction using Aider and review resulting diff before commit.

### US-5.10 ?? Voice Coding Spike: Custom Node Voice Agent
- Build a small Node.js voice coding prototype:
  - capture mic audio
  - transcribe with Whisper API
  - send instruction + repo context to LLM
  - apply/edit files in local workspace
- Include guardrails:
  - dry-run mode (show proposed diff only)
  - explicit apply confirmation step
  - audit log of prompt, model, and changed files.
- **Acceptance:** Prototype can run one spoken coding command and produce a reviewable patch with confirmation before write/apply.

---

## Current Production Status
- **Version:** jcw10 (deployed 2/13/2026)
- **Entries:** 151 APPROVED entries (weeks of 1/28, 2/4, 2/11)
- **Employees:** 8 active
- **Customers:** 89
- **URL:** https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com
- **Backup:** GCS backup verified good (86KB with 151 entries), `VACUUM INTO` ensures WAL data included
- **Cold-start hardening:** 3x retry + daily snapshot fallback + verification gate

## Feature Summary
| Feature | Status | Sprint | Where |
|---------|--------|--------|-------|
| Employee name on timesheets | ✅ Done | 2 | `generateWeekly.js` title row, `generateMonthly.js` stacked sections |
| Print-ready single page | ✅ Done | 2 | `pageSetup` in both generators |
| Stacked weeks (no tab explosion) | ✅ Done | 2 | `generateMonthly.js` consolidated employee sheets |
| Week selector dropdown | ✅ Done | 2 | `app.html` + `GET /api/payroll-weeks` |
| Muncey verification | ✅ Done | 2 | Jason Green 4h + Chris Zavesky 2.5h confirmed |
| Backup safety guard | ✅ Done | 2.5 | `lib/storage.js` row-count check + `__EMPTY__` guard |
| XLSX disaster recovery | ✅ Done | 2.5 | `scripts/import_from_xlsx.mjs` |
| Merge endpoint fix | ✅ Done | 2.5 | `server.js` INSERT OR IGNORE |
| WAL-safe backups (VACUUM INTO) | ✅ Done | 2.6 | `lib/storage.js` `createConsistentCopy()` |
| Retry + snapshot fallback restore | ✅ Done | 2.6 | `lib/storage.js` + `server.js` startup |
| API data migration tooling | ✅ Done | 2.6 | `tmp_clean_import.mjs` pattern |

## Data Recovery Log (2/12/2026)
| Time | Action | Result |
|------|--------|--------|
| ~11:50 AM | Noticed data loss after jcw6 deploy | 0 entries in prod |
| 12:30 PM | Root cause: empty DB cold-start overwrote GCS backup | — |
| 12:45 PM | Built XLSX import script | Parsed 131 entries from last export |
| 1:10 PM | Imported 120 entries + created 6 missing customers | 131 entries |
| 1:13 PM | Imported 11 remaining entries after customer creation | 131 entries |
| 1:19 PM | Added 12 lunch entries from 2/8 GCS snapshot | 143 entries |
| 1:20 PM | Deployed jcw7 with safety fixes | Backup guard + merge fix |
