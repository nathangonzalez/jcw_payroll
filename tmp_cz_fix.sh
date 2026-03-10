#!/bin/bash
DB=/home/nathan/dev/repos/jcw_payroll/labor-timekeeper/data/prod/app.db

echo "=== Chris Z entries on 2/18 week ==="
sqlite3 "$DB" "SELECT te.id, te.work_date, te.hours, te.status, c.name, e.name FROM time_entries te JOIN employees e ON e.id=te.employee_id JOIN customers c ON c.id=te.customer_id WHERE e.name LIKE '%avesky%' AND te.work_date >= '2026-02-18' AND te.work_date <= '2026-02-24' AND te.archived=0 ORDER BY te.work_date;"

echo ""
echo "=== Moving entries +7 days ==="
sqlite3 "$DB" "UPDATE time_entries SET work_date = date(work_date, '+7 days'), updated_at = datetime('now') WHERE employee_id IN (SELECT id FROM employees WHERE name LIKE '%avesky%') AND work_date >= '2026-02-18' AND work_date <= '2026-02-24' AND archived=0;"

echo "Rows changed: $(sqlite3 "$DB" "SELECT changes();")"

echo ""
echo "=== Chris Z entries after move ==="
sqlite3 "$DB" "SELECT te.id, te.work_date, te.hours, te.status, c.name, e.name FROM time_entries te JOIN employees e ON e.id=te.employee_id JOIN customers c ON c.id=te.customer_id WHERE e.name LIKE '%avesky%' AND te.work_date >= '2026-02-25' AND te.work_date <= '2026-03-03' AND te.archived=0 ORDER BY te.work_date;"