# Labor Timekeeper (MVP)

A single-node app (Express + SQLite) to:
- Let employees record **hours by day + customer** (manual or voice)
- Submit a weekly timesheet
- Let an admin approve
- Export Excel billing summaries with **admin/hourly split + overtime calculation**

## Quick start (local)

1) Requirements:
- Node.js 20+
- An OpenAI API key (for voice parsing). You can still use manual entry without it.

2) Install + seed:
```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY (optional for manual-only)
npm install
npm run seed
```

3) Run:
```bash
npm run start
# open http://localhost:3000
```

## Test logins (seeded)
- Chris Jacobi / PIN: 1111
- Chris Z / PIN: 2222
- Sean Matthew / PIN: 3333
- Jafid Osorio / PIN: 3333
- Doug Kinsey / PIN: 3333
- Jason Green / PIN: 3333
- Office Admin / PIN: 9999

## Voice commands examples
- "McGill 8 hours Friday"
- "8 hours Friday McGill, 2 hours Saturday Hall"
- "Change Friday McGill to 6 hours"

---

## 📊 Option A: XLSX Export Pipeline

### Features
- **Weekly exports**: One XLSX per employee per week
- **Monthly breakdown**: Aggregated payroll summary
- **Admin vs Hourly classification**: Chris Jacobi, Chris Z = admin (salaried), others = hourly
- **Overtime calculation**: Hours > 40/week = 1.5× rate for hourly employees
- **Holiday auto-population**: US federal holidays (New Year's, Memorial Day, July 4th, Labor Day, Thanksgiving, Christmas)
- **Draft persistence**: Form data saved to localStorage, restored on reload
- **Retention policy**: Close month to permanently delete processed entries

### Export Endpoints (Admin only)
```
GET  /api/admin/generate-week?week_start=YYYY-MM-DD  # Weekly per-employee exports
GET  /api/admin/generate-month?month=YYYY-MM          # Monthly breakdown
POST /api/admin/close-month { month, confirm: true }  # Delete month's entries
GET  /api/holidays?year=2026                          # List holidays
```

### Output Files
```
/exports/
  └── 2026-01/
      ├── 2026-01-06/                    # Weekly folder
      │   ├── Chris_Jacobi_2026-01-06.xlsx
      │   ├── Doug_Kinsey_2026-01-06.xlsx
      │   └── ...
      └── Payroll_Breakdown_2026-01.xlsx # Monthly summary
```

### Weekly XLSX Columns
| Date | Client | Hours | Type | Rate | Total |
|------|--------|-------|------|------|-------|
| 2026-01-06 | McGill | 8 | Regular | $65.00 | $520.00 |
| 2026-01-07 | McGill | 10 | OT | $65.00 | $975.00 |

### Simulation Script
Generate sample data and run the full export pipeline:
```bash
npm run simulate -- --reset --submit --approve
```

Options:
- `--reset`: Clear existing time entries first
- `--submit`: Auto-submit all generated entries
- `--approve`: Auto-approve and generate XLSX exports

---

## Notes
- Payroll week start is configured by `PAYROLL_WEEK_START` (default Monday).
- Dates are stored as YYYY-MM-DD in America/New_York.
- Admin classification: Chris Jacobi, Chris Z (salaried, no OT)
- Hourly employees: Everyone else (OT after 40hrs/week at 1.5×)

