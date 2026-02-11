# JCW Labor Timekeeper — Sprint Plan & User Stories

## Sprint 1: Data Integrity & Export Fix (Current — Week 2 Pilot)
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
- **Acceptance:** Zero DRAFT entries in prod; all 180 entries APPROVED

---

## Sprint 2: Timesheet Format & UX (Next Sprint)
**Goal:** Improve employee timesheets for print-ready single-page output

### US-2.1 Employee Name on Every Timesheet
- Each timesheet tab/section must prominently display the employee's full name
- Already partially done (title row has `Name — Date Range`)
- Ensure name appears in print header/footer as well
- **Acceptance:** When printed, employee name is clearly visible on every page

### US-2.2 Print-Ready Single Page Formatting
- Timesheets must fit on a single landscape page when printed
- Set `fitToPage`, `fitToWidth: 1`, `fitToHeight: 1` in page setup
- Adjust column widths, font sizes, and margins for optimal print layout
- **Acceptance:** File → Print produces clean single-page output in Excel

### US-2.3 Consolidated Single-Tab Export (Stacked Weeks)
- Instead of one tab per employee per week, stack all weeks on ONE sheet per employee
- Current week at the top, older weeks below with 4 blank separator rows
- Monthly breakdown and weekly summary sheets remain as separate tabs
- **Acceptance:** Export has ~8 employee sheets (not 16+), each with weeks stacked

### US-2.4 Muncey Timesheet Verification
- Cross-reference Muncey's timesheet against manual hard copy
- Verify hours, customers, and totals match
- Fix any discrepancies found
- **Acceptance:** Muncey's exported timesheet matches manual copy exactly

---

## Sprint 3: Formula Cascade & Monthly Accuracy
**Goal:** Ensure all cross-sheet formulas calculate correctly

### US-3.1 Fix Monthly Breakdown Formula References (e92/e93)
- Monthly Breakdown sheet SUMIF formulas must reference correct row ranges on stacked employee sheets
- Verify all hourly and admin employee totals cascade correctly
- **Acceptance:** Every cell in Monthly Breakdown shows correct calculated value

### US-3.2 OT Premium Auto-Calculation
- OT Premium section on weekly sheets must use formula: `MAX(0, employee_total - 40)`
- Reference employee timesheet TOTAL row for live cascade
- **Acceptance:** Editing hours on employee sheet auto-updates OT on weekly sheet

### US-3.3 Email Delivery Verification
- Monthly export email must arrive with XLSX attachment
- Test with `sendEmail=true` parameter
- Verify recipient list, subject line, and attachment name
- **Acceptance:** Email received with correct Payroll_Breakdown_2026-02.xlsx

---

## Sprint 4: Production Hardening
**Goal:** Stabilize for ongoing weekly use

### US-4.1 Automated Weekly Export Cron
- Set up App Engine cron job to auto-export every Tuesday (end of payroll week)
- Email results to payroll administrator
- **Acceptance:** Export runs automatically each week without manual trigger

### US-4.2 Data Backup & Recovery
- GCS backup on every DB change (already implemented)
- Add restore-from-backup admin endpoint (already implemented)
- Add backup rotation (keep last 30 days)
- **Acceptance:** Can restore any backup from the last 30 days

### US-4.3 Duplicate Entry Prevention
- Prevent submitting same employee/customer/date/hours combination twice
- Show warning in UI if potential duplicate detected
- **Acceptance:** Duplicate submissions are blocked with clear error message

---

## Current Production Status
- **Version:** jcw3 (deployed 2/11/2026)
- **Entries:** 180 APPROVED entries (weeks of 1/28 and 2/4)
- **Employees:** 8 active
- **Customers:** 90
- **URL:** https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com
