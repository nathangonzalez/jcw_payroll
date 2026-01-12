# Labor Timekeeper (MVP)

A single-node app (Express + SQLite) to:
- Let employees record **hours by day + customer** (manual or voice)
- Submit a weekly timesheet
- Let an admin approve
- Export basic Excel billing summaries

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

## Notes
- Payroll week start is configured by `PAYROLL_WEEK_START` (default Monday).
- Dates are stored as YYYY-MM-DD in America/New_York.
