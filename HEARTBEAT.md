# HEARTBEAT.md — Agent Work Queue
# Updated: 2026-03-01

## Current Focus: Complete Backlog Audit + Module Version Testing

---

### 🔴 URGENT — Fix Now
- [ ] **CI/CD Pipeline Failing** — GitHub Actions CI spamming email (fixed trigger: main-only). Still need to fix the actual test failures so CI goes green.
- [ ] **jcwelton.com Main Website** — Naked domain points to old Squarespace/GoDaddy hosting. Needs update or redirect to apps.jcwelton.com.

---

### 🎯 Module Audit Queue (work through in order)

#### 1. Estimator Pro (FLAGSHIP — 10+ versions)
- [ ] Clone all 10 estimator repos into workspace
- [ ] For each version: can it run? What inputs/outputs? Unique features?
- [ ] Build comparison test harness (same blueprint data across all versions)
- [ ] Score: accuracy, completeness, code quality, features
- [ ] Post comparison matrix to Slack for Nathan
- [ ] Recommend consolidation → prototype unified version on branch

#### 2. Financials
- [ ] Clone jcw_financials — what does the Python code actually compute?
- [ ] Can it connect to QuickBooks?
- [ ] Assess path to QBO integration (Q2 2026 target)

#### 3. Enterprise Suite
- [ ] Clone jcw-enterprise-suite (105MB Python)
- [ ] Determine: is this the unification target or should jcw-suite be?
- [ ] Document what's bundled (numpy, scipy, etc.)

#### 4. MainStreet Migrator
- [ ] Clone mainstreet_migrator — what is this tool? Still relevant?

---

### 📋 Payroll Backlog (Sprint 3 & 4 — Open)

#### Sprint 3: Formula Cascade & Monthly Accuracy
- [ ] **US-3.1** Fix Monthly Breakdown SUMIF formula references for stacked sheets
- [ ] **US-3.2** OT Premium auto-calculation (MAX(0, total - 40) formulas)
- [ ] **US-3.3** Email delivery verification (monthly export w/ XLSX attachment)

#### Sprint 4: Production Hardening
- [ ] **US-4.1** Automated weekly export cron (Tuesday auto-export + email)
- [ ] **US-4.3** Duplicate entry prevention (block same employee/customer/date/hours)

#### Ops Hardening (from OPS_HARDENING_PLAN.md)
- [ ] Backup guard: prevent empty DB upload even when consistent copy fails
- [ ] Fix reconcile/archive range mismatch (payroll month vs calendar month)
- [ ] Fix archive summary billed totals
- [ ] Add observability metrics (backup/restore counts + duration)

#### Recovered Requirements
- [ ] Auto-save/Draft (localStorage for partial entries)
- [ ] Voice command applyParsed() flow
- [ ] Export: weekly hourlyAmount, adminAmount, grand total rows
- [ ] Monthly Breakdown: GRAND TOTAL row
- [ ] Admin cleanup endpoints (clear test/seeded data)
- [ ] PWA/service worker maintenance

---

### 🏗️ Infrastructure Backlog
- [ ] **Decommission App Engine** — old payroll still running, no longer primary
- [ ] **Office Server cloud backup** — rclone → GCS
- [ ] **Shared files migration** — to Google Drive
- [ ] **QuickBooks Online migration** — Q2 2026 target, coordinate with financials module
- [ ] **Fix OpenClaw** — rate-limited since 2/21, needs backoff config or model switch
- [ ] **Service user mismatch** — `User=nathan` in systemd but actual user is `natha`

---

### 🔄 Routine Checks (2-4x daily)
- [ ] VM health: all services running?
- [ ] GCS backup: latest timestamp?
- [ ] Payroll entries: any employees missing submissions this week?

---

### Rules
- Post to Slack #jcw_bot ONLY with actionable findings
- Create branches for spikes, never commit to main without approval
- Wait for Nathan's 👍 before merging anything
- Log all work in memory/YYYY-MM-DD.md
