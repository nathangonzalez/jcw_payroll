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

---

## Current Production Status
- **Version:** jcw7 (deployed 2/12/2026)
- **Entries:** 143 APPROVED entries (weeks of 1/28, 2/4, and partial 2/11)
- **Employees:** 8 active
- **Customers:** 89
- **URL:** https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com

## Feature Summary
| Feature | Status | Sprint | Where |
|---------|--------|--------|-------|
| Employee name on timesheets | ✅ Done | 2 | `generateWeekly.js` title row, `generateMonthly.js` stacked sections |
| Print-ready single page | ✅ Done | 2 | `pageSetup` in both generators |
| Stacked weeks (no tab explosion) | ✅ Done | 2 | `generateMonthly.js` consolidated employee sheets |
| Week selector dropdown | ✅ Done | 2 | `app.html` + `GET /api/payroll-weeks` |
| Muncey verification | ✅ Done | 2 | Jason Green 4h + Chris Zavesky 2.5h confirmed |
| Backup safety guard | ✅ Done | 2.5 | `lib/storage.js` row-count check |
| XLSX disaster recovery | ✅ Done | 2.5 | `scripts/import_from_xlsx.mjs` |
| Merge endpoint fix | ✅ Done | 2.5 | `server.js` INSERT OR IGNORE |

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
