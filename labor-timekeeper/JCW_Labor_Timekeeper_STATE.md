# JCW Payroll – Labor Timekeeper – Continuity & Release Notes (Living Spec)
Generated: 2026-01-13 (America/New_York)

This document exists to preserve “state” across chats and tool runs. Treat it as the source of truth for:
- product requirements
- implementation decisions
- what’s working vs. what’s missing
- Copilot/Codex super-prompts and acceptance criteria

---

## 0) Current code snapshot reviewed
Source text: `code_review.txt` (exported by Copilot) containing server/UI/lib/scripts/tests for **labor-timekeeper v0.2.0**.

---

## 1) Core workflow (approved)
1) Employee logs hours by **day + client** (UI + voice).
2) Employee submits week → entries become **SUBMITTED**.
3) Admin approves entries → entries become **APPROVED**.
4) Admin generates exports:
   - **Weekly per-employee workbook** (one file per employee)
   - **Monthly payroll breakdown workbook** (one file per month)
5) After payroll admin confirms month: **purge/reset** month data.

Retention: keep entries only until payroll confirmed for the month; then delete.

---

## 2) Requirements (authoritative)
### 2.1 Employee roles / categories
- Admin category: **Chris Jacobi**, **Chris Zavesky** (alias “Chris Z”)
- Hourly category: everyone else
- Split admin hours from hourly in reports. Admin internal cost not revealed; still include totals.

### 2.2 Time categories (no “Sick”)
Valid entry types:
- Regular
- PTO
- Holiday
(Sick removed.)

### 2.3 Overtime (hourly only)
- Hourly employees: **OT after 40 hrs/week** at **1.5×**.
- Admin employees: no OT logic.

Recommended interpretation:
- OT threshold should apply to **Regular** hours only (PTO/Holiday should not push someone into OT). If you want PTO/Holiday to count toward OT threshold, decide explicitly.

### 2.4 Holidays (auto-populate)
Paid holidays:
- New Year’s Day
- Memorial Day
- Independence Day
- Labor Day
- Thanksgiving
- Christmas Day

Behavior:
- UI should **suggest** Holiday entry on those dates (usually 8 hours), and user can confirm/edit.
- If company occasionally gives “Friday after Thanksgiving,” it doesn’t need to be hard-coded; they can select Holiday manually.

### 2.5 Client matching by address + free add
- Customer list should include **name + address** for confirmation.
- If client does not auto-populate, allow **free text client entry** without validation.
- Server should support **find-or-create** by name (and ideally address).

### 2.6 Draft persistence (offline safety)
- Form state must persist if signal drops or tab closes.
- Minimum: localStorage draft restore.
- Better: queue unsent POSTs (service worker/PWA) – optional later.

### 2.7 Outputs / artifacts
Option A (fast):
- Generate .xlsx programmatically (ExcelJS).
- One weekly workbook **per employee**.
- One monthly breakdown workbook.

Option B (fidelity):
- Write into a saved server template (converted to .xlsx) to preserve formatting / layout.

---

## 3) What’s implemented in v0.2.0 (per code_review.txt)
### 3.1 Endpoints
- /api/admin/generate-week  (weekly per-employee exports)
- /api/admin/generate-month (monthly breakdown export)
- /api/admin/close-month    (deletes entries for YYYY-MM)
- /api/holidays             (holiday list)
- /api/customers/find-or-create (create customer if missing)

### 3.2 Weekly export
- Reads APPROVED entries
- Splits OT for hourly using cumulative hours

### 3.3 Monthly export
- Produces a **wide pivot**: Client + [Emp Hours, Emp Rate, Emp Amount] columns
- Adds a category breakdown section

### 3.4 Draft persistence
- localStorage key: labor_timekeeper_draft

### 3.5 Admin UI
- Buttons for weekly/monthly exports + close month

---

## 4) Known gaps / bugs (high priority)
These are concrete issues discovered from code review.

### 4.1 Customers missing addresses
- DB customers table only has (id, name, created_at)
- /api/customers returns only id, name
Needs:
- Add customers.address column
- Seed with (name, address)
- UI should display “Name — Address” and/or confirm address on selection.

### 4.2 Free client entry not supported in UI
- Current app.html uses <select id="customer"> only.
Needs:
- Switch to input + datalist (or combo box) and allow free text.
- When free text used, call /api/customers/find-or-create then save entry.

### 4.3 find-or-create endpoint bug
In server.js:
- `created: !customer` is wrong (customer is always truthy by response time).
Fix:
- Track `created = false` then set `created = true` when inserting.

### 4.4 Entry type isn’t a first-class field
- time_entries table has no `entry_type` or `pay_type`.
- Weekly export infers PTO from notes and Holiday from calendar date.
Needs:
- Add `entry_type` column: REGULAR|PTO|HOLIDAY
- UI control to choose type
- Voice parser should output type
- OT threshold should likely apply only to REGULAR.

### 4.5 Voice parsing rules mismatch
Current voice system prompt says:
- “Customer must be chosen from provided list” and blocks entries without customer_id.
But requirement says:
- allow free text client without validation.
Needs:
- If customer not matched, return customer_name as text; UI should offer “Create client” and proceed.

### 4.6 Holidays “auto-populate” not actually implemented
- Holidays library exists, but UI doesn’t insert default Holiday entries.
Needs:
- On week load, if a holiday falls inside week, show a banner and one-click “Add 8 hrs Holiday” per holiday day.

### 4.7 Playwright tests mismatched to API responses/auth
- /api/customers requires auth but API test calls without cookies.
- /api/holidays response is an object, not array.
- Admin generate-month response uses filename/filepath, test expects json.file.
Needs:
- Fix tests to login and reuse session cookies in API tests.
- Align assertions to real payloads.

---

## 5) Recommended next commits (Option A harden)
### Commit A1: Customer address + free entry
- DB migration: add customers.address
- Seed: customers.json should be array of {name,address}
- UI: replace customer <select> with input + datalist and find-or-create

### Commit A2: Entry type + OT correctness
- DB migration: add time_entries.entry_type default REGULAR
- UI: dropdown for type (Regular/PTO/Holiday)
- Voice: parse “day client 8 hours regular/pto/holiday”
- OT: apply OT only to REGULAR; PTO/Holiday never becomes OT

### Commit A3: Holiday autopopulate
- On week load: fetch holidays in range, show “Add Holiday” button per holiday date (default 8 hours)

### Commit A4: Fix tests
- Authenticated API tests
- Stable selectors/waits

### Commit A5: Production deploy notes
- docker-compose + persistent volume for /data and /exports
- HTTPS reverse proxy later (Caddy/Nginx)

---

## 6) Copilot/Codex supervisory mode (how to work going forward)
Use Copilot for implementation, and use this checklist as “architect review”:

### For each PR/branch
- ✅ Matches acceptance criteria for the commit (A1/A2/A3…)
- ✅ DB migration is backward-compatible (existing app.db doesn’t break)
- ✅ Exports are generated in /exports/<YYYY-MM>/<weekStart>/
- ✅ Hourly OT math matches spec
- ✅ Free text clients work end-to-end
- ✅ Tests pass locally: `npm test`

### Super-prompt pattern
Provide Copilot:
1) exact files to modify
2) exact DB migration SQL
3) example inputs + expected outputs
4) how to test (commands + expected results)

---

## 7) “How to restore context quickly”
If a new chat starts, paste:
- this document OR
- the “Known gaps / bugs” section + your desired next commit (A1/A2/A3)

That’s enough for immediate continuity.

