#!/bin/bash
cd /home/nathan/dev/repos/jcw_payroll/labor-timekeeper
sqlite3 data/app.db "SELECT te.id, te.work_date, te.hours, te.status, c.name, e.name FROM time_entries te JOIN employees e ON e.id=te.employee_id JOIN customers c ON c.id=te.customer_id WHERE e.name LIKE '%avesky%' AND te.work_date BETWEEN '2026-02-18' AND '2026-02-24' AND te.archived=0 ORDER BY te.work_date"