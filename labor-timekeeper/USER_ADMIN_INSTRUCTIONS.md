# Labor Timekeeper - User and Admin Instructions

## Employee (Hourly or Admin)

1) Open the app and select your name.
2) For each time block:
   - Pick the day.
   - Set Start and End time (24-hour).
   - Choose a client (or type a new client name).
   - Add optional notes in the Notes field.
   - Click Save / Update.
3) Lunch:
   - Say or enter Lunch as a customer (lunch is deducted from the day).
   - Example: Lunch 12:00 to 12:30.
4) Multiple clients on the same day:
   - Add another block for the same day and enter the next time range.
5) Voice entry:
   - Click Start Recording and speak the entries.
   - Parsed entries show start/end selectors so you can edit before they auto-apply.
   - Say the day each time you switch days (ex: "Monday ...", "Tuesday ...").
   - Use "lunch 12:00 to 12:30" once per day.
   - If a client is not found, the typed customer name will be created automatically.
6) Week total:
   - The Week total excludes Lunch.
7) Add a weekly comment (optional) and Submit Week.
8) If you submit and need to fix something, use Reopen Week to edit and resubmit.

Example voice:
Wednesday 7:30 to 11 Landy, then 11 to 12 Tercek, lunch 12 to 12:30,
then 12:30 to 2 Landy, then 2 to 4 Tercek.

## Admin

1) Open the app and use the Admin button.
2) Enter the admin secret to access the admin panel.
3) Review submitted entries:
   - Approve individual entries or approve all.
   - Use the week selector to review previous weeks.
   - Use the preview report to validate totals without downloading.
4) Download reports:
   - Use the single monthly download (monthly totals are sum of weekly).
   - Use the month selector to view/download older months (ex: February).

6) Troubleshooting:
   - If a report looks off, verify Lunch entries are present and have start/end times.
   - Missing rates or missing customers cause $0 totals; ensure employee rates exist.
   - Simulate Month no longer overwrites existing entries (safe to run).
   - Reconcile clears the live DB for that month; history is kept in archives.
   - Use week/month selectors to review live history before reconciliation.

## Notes

- Payroll week runs Wednesday through Tuesday.
- Lunch is treated as a customer for entry, but is deducted in totals.
- Voice parsing always maps spoken days into the current payroll week.
- Payroll months follow a 4-4-5 calendar starting 12/31/2025 for 2026 
