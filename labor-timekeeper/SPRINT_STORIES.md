# Sprint: Timesheet Export Improvements (Week 2 Pilot)

## Context
Second week of production pilot implementation. We have hard manual copies (in `2_4/` folder) to verify against system-generated exports. Key issues identified:

- Muncey customer entries (on Jason Green's timesheet) need verification against manual
- Employee timesheets are missing the employee name
- Timesheets don't print cleanly on a single page
- Monthly export creates too many tabs (one per employee per week)

---

## Sprint 1: Data Verification & Export UX

### User Story 1: Employee Name on Timesheets
**As a** payroll administrator  
**I want** each timesheet to clearly show the employee's name  
**So that** I can identify whose timesheet I'm looking at when reviewing or printing  

**Acceptance Criteria:**
- [ ] Employee name appears prominently at the top of Sheet1 (row before header)
- [ ] Employee name + week date range shown (e.g., "Jason Green — 2/4/26 - 2/10/26")
- [ ] Applies to both weekly individual exports and monthly bundled exports
- [ ] Font is bold, slightly larger than data rows

**Effort:** Small (1 point)

---

### User Story 2: Print-Friendly Timesheet Formatting
**As a** payroll administrator  
**I want** each timesheet to fit on a single printed page  
**So that** I can hit Print and get a clean, complete timesheet without manual adjustments  

**Acceptance Criteria:**
- [ ] Excel page setup configured to fit all columns on 1 page wide
- [ ] Fit to 1 page tall (or auto-shrink)
- [ ] Landscape orientation for the 12-column layout
- [ ] Print area set to used range only
- [ ] Reasonable margins (0.5" or narrow)
- [ ] Header row repeats on each page (if multi-page)

**Effort:** Small (1 point)

---

### User Story 3: Consolidated Employee Timesheets (Eliminate Tab Explosion)
**As a** payroll administrator  
**I want** each employee's weekly timesheets stacked on a single sheet (current week on top)  
**So that** I don't have to navigate dozens of tabs in the monthly export  

**Acceptance Criteria:**
- [ ] Monthly export: one sheet per employee (not one per employee-per-week)
- [ ] Current/latest week appears at the top of the sheet
- [ ] Older weeks follow below with 3-4 blank rows of separation
- [ ] Each week section has a clear header (e.g., "Week of Feb 4, 2026")
- [ ] Right-side summary panel (Client | Hours | Rate | Total) appears for each week section
- [ ] Total row per week section preserved
- [ ] Cross-sheet formulas in breakdown sheets still reference correct cells

**Effort:** Medium (3 points)

---

### User Story 4: Muncey / Week 2/4 Data Verification
**As a** payroll administrator  
**I want** the system data for week 2/4 verified against the manual hard copies  
**So that** I can trust the system output matches reality  

**Acceptance Criteria:**
- [ ] Compare Jason Green's Muncey entries (Insp: 1.0hr, Maint: 2.5hr) against system
- [ ] Compare all 6 employees' hours/clients/rates from manual 2_4/ files against system
- [ ] Document any discrepancies found
- [ ] Fix data issues if any

**Verification Data (from manual 2_4 files):**

| Employee | Total Hours | Rate | Total $ | Key Clients |
|---|---|---|---|---|
| Jason Green | 40.0 | $35 | $1,400 | Boyle(7.5), Muncey-Insp(1), Muncey-Maint(2.5), Tubergen(7), McFarland(6), Landy(4.5), Lucas(2.5), Richer(3.5), others |
| Boban Abbate | 40.0 | $42.50 | $1,700 | Boyle(36), Campbell(1), Sweeney(1), Walsh-Insp(1), Walsh-Maint(1) |
| Phil Henderson | 40.0 | $30 | $1,200 | Watkins(38.5), Tubergen(1.5) |
| Sean Matthew | 40.0 | $20 | $800 | Boyle(24), JCW Shop(8), PTO(8) |
| Doug Kinsey | 40.25 | $30 | $1,211.25 | JCW Shop(15), Boyle(10.5), Watkins(4.75), Lynn(2), PTO(8) |
| Thomas Brinson | 39.5 | $35 | $1,400 | Landy(21.5), Boyle(17.5), Delacruz NB(0.5), PTO(0.5) |

**Effort:** Medium (2 points)

---

## Sprint Priority Order
1. **Story 1** - Employee name (quick win, high visibility)
2. **Story 2** - Print formatting (quick win, daily need)
3. **Story 3** - Consolidated tabs (bigger change, biggest UX impact)
4. **Story 4** - Data verification (ongoing, can run in parallel)

**Total Sprint Points:** 7
