# SUPER PROMPT (Cline) — Labor Timekeeper MVP [HISTORICAL REFERENCE]

> ⚠️ **This file was used with Cline in VSCode.**
> As of 2026-02-22, the primary context for GitHub Copilot Coding Agent is maintained in:
> - `/MEMORY.md` — curated project state, backlog, and deploy notes
> - `/AGENTS.md` — agent instructions and workspace conventions
> Daily session logs live in `memory/YYYY-MM-DD.md`.
> This file is kept for reference only.

Goal: Ensure the repo runs on first try and supports:
- Employee login (name+PIN)
- Log hours by day + customer (manual)
- Voice command: record audio -> OpenAI transcription -> structured parse -> apply entries
- Submit week (locks entries)
- Admin approvals + exports (monthly summary + invoice workbook)

## Non-negotiables
- Keep UI extremely simple for non-technical crews.
- Interpreting weekday words must map to the CURRENT payroll week.
- Customer list comes from `seed/customers.json` (extracted from templates).
- Do NOT break manual entry if OpenAI key is missing; voice should show a friendly error.

## How to run
1) `cp .env.example .env` (set OPENAI_API_KEY if using voice)
2) `npm install`
3) `npm run seed`
4) `npm run start`
Open:
- http://localhost:3000 (login)
- http://localhost:3000/app (employee)
- http://localhost:3000/admin (admin)

## Seed users
- Chris Jacobi / 1111
- Chris Z / 2222
- Office Admin / 9999

## Smoke tests
- Login as Chris Jacobi
- Manual: pick customer "McGill", day Friday, hours 8 → Save
- Entries table updates
- Submit week → status moves to SUBMITTED
- Login as Office Admin → Approvals shows entry → select → Approve
- Export monthly summary (this month) downloads XLSX
- Export invoice: McGill, date range spanning that Friday downloads XLSX

## Voice test
- Login as Chris Jacobi
- Click Start Recording, say: "McGill 8 hours Friday"
- Stop Recording → should return transcript + parsed entry (Friday of current payroll week)
- Apply parsed entries → entry saved

## Notes
- Voice endpoint is `/api/voice/command` and requires OPENAI_API_KEY.
- Uses `openai.audio.transcriptions.create` and `openai.responses.parse` with json_schema.
- If customers grow large later, switch to server-side retrieval rather than embedding full list in the prompt.
