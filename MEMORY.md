# MEMORY.md — Long-Term Memory
# Last consolidated: 2026-03-01

> Curated long-term memory for the JCW workspace.
> Daily raw logs: `memory/YYYY-MM-DD.md`. This file is the distilled reference.

---

## 🏢 JCW Enterprises — The Vision

JCW Construction is building a **vertically integrated construction technology platform** — the JCW Enterprise Suite. The goal: eliminate manual overhead so the team focuses on building, not paperwork.

**Owner:** Chris Jacobi
**IT/Operations:** Nathan Gonzalez (Nate)
**Domain:** jcwelton.com
**Crew:** ~8 field employees + 2 admins

### The Business Value Chain
```
Win Bids → Execute Projects → Track Labor → Pay People → Pay Vendors → Get Paid → Know Your Numbers
   ↑              ↑                ↑            ↑            ↑           ↑            ↑
Estimator    Tasks Dashboard  Timekeeper   Payroll Export  AP Automation  QBO      Financials
```

---

## 📦 Module Inventory

### 1. Estimator Pro (FLAGSHIP — Highest Priority)
- **Repos:** jcw-estimator-pro, jcw-2-admin, jcw_ai_estimator, jcw_estimate_android, estimator-backend, ConstructionEstimator (1.0, 2.0, 3.0), jcw_estimate, jcw_estimate_ai-
- **Stack:** Python (AI/ML, dimensional analysis) + HTML + Android
- **GCP Project:** jcw-2-android-estimator
- **Maturity:** 10+ iterations since 2018, most iterated module
- **Status:** NOT production-ready — needs audit across all versions
- **Key Features:** Blueprint parsing, dimensional intelligence, scaling engine, cost calculation, risk assessment, sensitivity analysis
- **Next:** Agent audits all versions → extracts best parts → builds unified version → Nathan reviews

### 2. Labor Timekeeper (PRODUCTION ✅)
- **Repo:** jcw_payroll/labor-timekeeper
- **Stack:** Node.js + SQLite + Express
- **URL:** https://payroll.jcwelton.com/app
- **Version:** Running on VM (clawbot-ops), migrated from App Engine 2/27
- **Status:** Production, 285+ entries, 8 employees, 93 customers
- **Features:** Voice input (Whisper), admin approval (PIN: 7707), XLSX export, GCS backup every 5 min, email notifications
- **Data:** SQLite at /opt/labor-timekeeper/data/app.db on VM
- **Backup:** gs://jcw-labor-timekeeper/backups/

### 3. Tasks Dashboard (SHIPPED)
- **Repo:** jcw-suite/apps/tasks
- **Stack:** Node.js + Express + better-sqlite3
- **URL:** https://tasks.jcwelton.com
- **Status:** Just deployed 2/27, 561 tasks imported from Actions.xlsx
- **Categories:** 222 Home, 221 JCW, 26 Reno, 11 Research, 24 Maintenance, 25 Scope, 11 CRM, 21 WIP
- **Next:** Validate it replaces Actions.xlsx — add due dates, assignments, priority

### 4. Financials (EARLY)
- **Repo:** jcw_financials
- **Stack:** Python (189KB)
- **Status:** Early/research stage
- **Related research:** accounts-payable-automation.md (Dext + Bill.com recommended)
- **Next:** Agent audits codebase → determines what it does → proposes path to QBO integration

### 5. Enterprise Suite (PROTOTYPE)
- **Repo:** jcw-enterprise-suite
- **Stack:** Python (massive — 105MB, includes numpy/scipy/C extensions)
- **Status:** Prototype — likely bundles estimator + financials
- **Next:** Agent audits → determines if this is the unification target or if jcw-suite is better

### 6. Agent Ops (INFRASTRUCTURE)
- **Repo:** jcw-agent-ops
- **Stack:** Multi-agent (OpenClaw), GitHub Actions, Slack bot
- **Status:** Partially working — OpenClaw broken (rate-limited), Slack bot running, GH Actions partial
- **Next:** Fix the autonomous loop so agents actually improve modules

### 7. Suite Shell (DEPLOYED)
- **Repo:** jcw-suite
- **Stack:** Node.js + Caddy reverse proxy
- **URL:** https://apps.jcwelton.com
- **Status:** Landing page deployed, links to all apps

---

## 🖥️ Infrastructure

| Component | Location | Status |
|-----------|----------|--------|
| **VM** | clawbot-ops (34.31.213.200), GCP us-central1-a, e2-medium | ✅ Running |
| **Caddy** | Ports 80/443, auto-TLS via Let's Encrypt | ✅ Running |
| **DNS** | Squarespace (formerly Google Domains), NS: ns-cloud-e* | ✅ Configured |
| **GCS Backups** | gs://jcw-labor-timekeeper | ✅ Every 5 min |
| **App Engine** | jcw-2-android-estimator project | ⚠️ Old payroll still running (not primary) |
| **Slack Bot** | clawbot.service on VM | ✅ Running |
| **Code Server** | Port 8443 on VM | ✅ Running |
| **VS Code Tunnel** | jcw-dev-server | ✅ Running |

### Live URLs
- **payroll.jcwelton.com** → :8080 (labor-timekeeper) ✅
- **tasks.jcwelton.com** → :3001 (tasks dashboard) ✅
- **apps.jcwelton.com** → :3000 (suite shell) ✅
- **code.jcwelton.com** → :8443 (code-server) ✅

---

## 🔄 Version Testing Strategy

For modules with multiple repo versions (especially Estimator):

1. **Clone all versions** into workspace subdirectories
2. **Create a test harness** with standardized inputs (e.g., same blueprint data)
3. **Run each version** against the test inputs
4. **Score outputs** on: accuracy, completeness, features, code quality
5. **Build a comparison matrix** — post to Slack for Nathan
6. **Extract winners** — cherry-pick best code from each version
7. **Consolidate** into one repo (likely jcw-estimator-pro or new jcw-suite/apps/estimator)
8. **Prototype unified version** on a branch → Nathan reviews

---

## 🤖 Autonomous Improvement Loop

The agent's 24/7 job:

```
PICK module → AUDIT code → SPIKE improvement → POST to Slack → WAIT for approval → IMPLEMENT → LOG → repeat
```

**Slack posts should be:**
- Module audit summaries (what works, what's broken)
- Spike proposals (here's what I built, here's the branch)
- Comparison results (version A vs B vs C)
- Approval requests (merge? deploy?)

**Slack posts should NOT be:**
- Generic "still running" status updates
- Rate limit errors
- Empty heartbeat confirmations

---

## 📋 Key API Endpoints (Labor Timekeeper)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/time-entries` | POST | Create/update time entry |
| `/api/submit-week` | POST | Submit week (DRAFT → SUBMITTED) |
| `/api/approvals?week_start=YYYY-MM-DD` | GET | Get pending entries |
| `/api/approve` | POST | Approve entries `{ids: [...]}` |
| `/api/admin/force-backup` | POST | Trigger GCS backup |
| `/api/health` | GET | Health check |

---

## 🔲 Open Backlog (from Sprint Stories + Ops Hardening + Recovered Requirements)

### Payroll (Sprint 3 & 4)
- US-3.1: Monthly Breakdown SUMIF formula references
- US-3.2: OT Premium auto-calculation
- US-3.3: Email delivery verification
- US-4.1: Automated weekly export cron
- US-4.3: Duplicate entry prevention
- Backup guard (empty DB edge case)
- Reconcile/archive range mismatch
- Archive summary billed totals
- Observability metrics
- Auto-save/Draft (localStorage)
- Voice command applyParsed() flow
- Export totals (hourlyAmount, adminAmount, grand total)
- Monthly GRAND TOTAL row
- Admin cleanup endpoints
- PWA/service worker maintenance

### Infrastructure
- CI/CD pipeline: was triggering on ALL branches → spam (fixed trigger 3/1, tests still failing)
- jcwelton.com main website: naked domain → old Squarespace hosting, needs update
- Decommission App Engine (old payroll)
- Office Server cloud backup (rclone → GCS)
- Shared files migration → Google Drive
- QuickBooks Online migration (Q2 2026)
- Fix OpenClaw rate limit loop
- Service user mismatch (nathan vs natha)

## ⚠️ Known Issues

1. Voice command: `/tmp/uploads` permission issue — fixed with chmod 777 (2/27)
2. Service unit has `User=nathan` but VM user is `natha`
3. OpenClaw: rate-limited on Copilot, stuck in retry loop since ~2/21
4. Slack bot: approval buttons sometimes produce NoneType errors
5. App Engine: still running old payroll code — not decommissioned
6. CI/CD workflow was on `**` branches → email spam (trigger fixed 3/1, tests still red)
7. jcwelton.com naked domain still points to old hosting

---

## 📝 Lessons Learned

- SQLite on App Engine is ephemeral — always back up to GCS
- Never deploy to prod without Nathan's explicit approval
- DNS for jcwelton.com is managed at Squarespace (formerly Google Domains)
- `&&` doesn't work in PowerShell — use `;` instead
- Anthropic is last resort for API spend — use subscription models first
- The estimator is the crown jewel — it's been the longest-running project
