# JCW Enterprise Suite — Status
# Updated: 2026-03-01

## 🎯 Mission

Build a vertically integrated construction technology platform. Agents work 24/7 auditing, improving, and testing modules. Nathan reviews and approves.

---

## Module Status

| # | Module | Repo(s) | Stack | Status | URL |
|---|--------|---------|-------|--------|-----|
| 1 | **Estimator Pro** | 10+ repos (see MEMORY.md) | Python + HTML + Android | 🔴 Needs audit — 10+ versions, not production-ready | — |
| 2 | **Labor Timekeeper** | jcw_payroll/labor-timekeeper | Node.js + SQLite | 🟢 **Production** | payroll.jcwelton.com |
| 3 | **Tasks Dashboard** | jcw-suite/apps/tasks | Node.js + SQLite | 🟡 Shipped, needs validation | tasks.jcwelton.com |
| 4 | **Financials** | jcw_financials | Python | 🔴 Early — needs audit | — |
| 5 | **Enterprise Suite** | jcw-enterprise-suite | Python (105MB) | 🔴 Prototype — needs audit | — |
| 6 | **Agent Ops** | jcw-agent-ops | Multi-agent + Slack | 🟡 Partially working | — |
| 7 | **Suite Shell** | jcw-suite | Node.js + Caddy | 🟢 Deployed | apps.jcwelton.com |

---

## Infrastructure

| Component | Status |
|-----------|--------|
| VM (clawbot-ops) | 🟢 Running — 34.31.213.200 |
| Caddy (HTTPS) | 🟢 Auto-TLS for *.jcwelton.com |
| GCS Backups | 🟢 Every 5 min |
| Slack Bot | 🟢 Running (needs better messages) |
| OpenClaw | 🔴 Broken — rate-limited since 2/21 |
| Code Server | 🟢 code.jcwelton.com |

---

## Agent Work Mode

**Current:** Autonomous Module Improvement Loop
```
PICK module → AUDIT → SPIKE → POST to Slack → WAIT for approval → IMPLEMENT → LOG
```

**Next action:** Estimator Pro deep audit (10+ versions)

---

## Version Testing Strategy

For modules with multiple versions:
1. Clone all versions
2. Create standardized test inputs
3. Run each version, score outputs
4. Build comparison matrix → Slack
5. Extract best code from each
6. Consolidate into unified repo
7. Prototype on branch → Nathan reviews
8. Pick winner → deploy to jcwelton.com

---

## Model Strategy

| Priority | Model | Cost | Use For |
|----------|-------|------|---------|
| 1 | OpenAI GPT-4.1 / Copilot | ✅ Subscription | Primary coding |
| 2 | Cline M2 (Free) | ✅ Free | Heartbeats, light tasks |
| 3 | Gemini Flash | 💰 Cheap | Simple tasks, fallback |
| 4 | Gemini 2.5 Pro | 💰 Moderate | Large context |
| 5 | Anthropic Sonnet | 💰💰 Expensive | Last resort |
