# HEARTBEAT.md — Agent Work Queue
# Updated: 2026-03-01

## Current Focus: Module Audit & Version Testing

### Priority Queue (work through in order)

- [ ] **1. Estimator Pro Audit** — Clone all 10+ estimator repos. For each: can it run? What does it do? What's unique? Build comparison matrix. Post findings to Slack.
- [ ] **2. Financials Audit** — Clone jcw_financials. Read code. What does it actually compute? Can it connect to QBO?
- [ ] **3. Enterprise Suite Audit** — Clone jcw-enterprise-suite. It's 105MB Python — what's in there? Is it the unification target?
- [ ] **4. Tasks Dashboard Polish** — Review tasks app. Does it fully replace Actions.xlsx? Missing: due dates, assignments, priority sorting.
- [ ] **5. Payroll Maintenance** — Voice command fix verified? Export formatting clean? Auto-reminders for missed entries?

### Estimator Version Test Plan

Repos to audit (oldest → newest):
1. ConstructionEstimator (original)
2. ConstructionEstimator2.0
3. ConstructionEstimator3.0
4. jcw_estimate
5. jcw_estimate_android
6. jcw_estimate_ai-
7. estimator-backend
8. jcw_ai_estimator
9. jcw-2-admin ("Estimating App")
10. jcw-estimator-pro (latest, most complete)

For each version, document:
- Can it run? (dependencies, errors)
- What inputs does it accept? (blueprints, manual entry, photos)
- What outputs does it produce? (cost estimates, reports, risk analysis)
- Unique features not in other versions?
- Code quality (tests, docs, architecture)
- Best candidate for the unified version?

### Routine Checks (rotate, 2-4x daily)
- [ ] VM health: `systemctl status labor-timekeeper jcw-tasks jcw-suite-shell caddy`
- [ ] GCS backup: verify latest backup timestamp
- [ ] Payroll entries: any employees missing submissions this week?

### Rules
- Post to Slack #jcw_bot ONLY with actionable findings
- Create branches for spikes, never commit to main
- Wait for Nathan's 👍 before merging anything
- Log all work in memory/YYYY-MM-DD.md
