# JCW Systems Status — 2026-02-23

## 🔴 The OpenClaw / Codex Rate Limit Issue

**What's happening:** Both OpenClaw and Codex show `⚠️ API rate limit reached` on `openai/gpt-4.1`. This is your **Copilot subscription's rate limit** — NOT the OpenAI Platform API.

**Key distinction:**
- **GitHub Copilot** = subscription, uses GitHub OAuth, rate limits managed by GitHub (RPM caps, possible daily limits)
- **OpenAI Platform API** (`sk-proj-*` key) = separate product, pay-per-token. The key in GCP Secret Manager returns **401 Invalid** — it's expired/revoked.
- OpenClaw and Codex route through Copilot's compatibility layer, NOT the OpenAI API directly

**Why the loop:** When rate-limited, both tools retry immediately with no backoff, burning the entire limit as soon as it refills (every ~60s). This creates an infinite rate-limit cycle.

**Fix options:**
1. **Update OpenClaw** — v2026.2.15 → v2026.2.21-2 (`openclaw update`), may have better rate limit handling
2. **Reduce agent concurrency** — don't let orchestrator + research hit the API simultaneously  
3. **Configure fallback model** — when gpt-4.1 rate-limits, fall back to M2 or Gemini Flash
4. **Replace the expired OpenAI API key** if you want direct API access (separate from Copilot)

**Rate limit reset behavior (Copilot):**
- RPM limits: Reset every 60 seconds
- Daily/monthly caps: Reset on billing cycle (check github.com/settings/copilot)
- No public API to check Copilot rate limit status — GitHub doesn't expose headers

The `group:memory` warning is a separate non-critical issue — the memory plugin isn't enabled in OpenClaw but agents reference it in their tool allowlists.

---

## 🧭 Model Strategy (Revised)

| Priority | Model | Cost | Best For | Limits |
|----------|-------|------|----------|--------|
| 1 | **OpenAI GPT-4.1 / Copilot** | ✅ Subscription (free per-token) | Primary coding, complex reasoning | RPM/TPM rate limits — can't burst |
| 2 | **Cline M2 (Free)** | ✅ Free | Heartbeats, git checks, memory updates, light tasks | Unknown limits |
| 3 | **Gemini Flash** | 💰 Cheap (~$0.075/1M input) | Simple tasks, summaries | Good for high-volume low-complexity |
| 4 | **Gemini 2.5 Pro** | 💰 Moderate | Large context, fallback for complex | Use sparingly |
| 5 | **Anthropic Claude Sonnet** | 💰💰 Expensive (~$3/1M input) | Last resort for complex reasoning | Most expensive option |

**Key change from previous .clinerules:** Anthropic moves to LAST resort, not second. OpenAI stays primary. M2 and Gemini Flash fill the gap.

---

## 🏗️ Active Systems ("Pilots")

### 1. Cline (this session) — LOCAL
- **What:** AI coding assistant running in VS Code
- **Where:** Your local PC (Windows 11, VS Code)
- **Model:** Currently Anthropic Sonnet (should switch to Copilot/OpenAI when rate limit resets)
- **Repos:** `jcw_payroll`, `agent-ops`
- **Status:** ✅ Active — this is what you're talking to right now

### 2. VS Code Tunnel — VM (clawbot-ops)
- **What:** VS Code Server running as systemd service, accessible via browser
- **Where:** GCP VM `clawbot-ops` (e2-medium, 4GB RAM, 34.31.213.200)
- **URL:** https://vscode.dev/tunnel/jcw-dev-server
- **Status:** ✅ Running (just restarted, relay connected)
- **Cline:** ❌ Not yet installed — needs first browser connection to install extensions
- **Purpose:** 24/7 always-on agent that survives your laptop closing

### 3. code-server — VM (clawbot-ops)
- **What:** Open-source VS Code web (coder/code-server)
- **Where:** Same VM, port 8080
- **URL:** http://34.31.213.200:8080 (password: jcw_dev_2026)
- **Status:** ✅ Running
- **Cline:** Installed but config buttons don't work (limited webview support)
- **Purpose:** Backup access / quick file viewing only

### 4. OpenClaw — LOCAL
- **What:** Multi-agent orchestrator (orchestrator, research, coder, qa, release, analyst, finance, scout agents)
- **Where:** Your local PC (gateway on ws://127.0.0.1:18789)
- **Model:** `openai/gpt-4.1` via subscription
- **Status:** 🔴 BROKEN — API rate limit loop, no backoff, hasn't worked since ~Feb 21
- **Config:** `agent-ops/openclaw.json`
- **Purpose:** Multi-agent coordination — orchestrator delegates to specialist sub-agents

### 5. Slack Bot (Clawbot) — VM (clawbot-ops)
- **What:** Slack relay bot for @jcw_service mentions
- **Where:** `clawbot.service` on the VM
- **Status:** ✅ Running
- **Features:** Kill switch (`/kill`), status reporting, approval queue
- **Channel:** #jcw_bot (C0AFSUEJ2KY)

### 6. GitHub Actions Workflows — CLOUD
- **What:** Automated CI/CD pipelines
- **Where:** GitHub (agent-ops repo)
- **Workflows:**
  - `story-generator.yml` — twice daily research stories (8AM + 4PM EST) ✅ Tested, working
  - `research-digest.yml` — daily/weekly research digests ⚠️ Not yet tested
  - `deploy-slackbot.yml` — manual deploy to Cloud Run ⚠️ Missing GCP secrets
- **Status:** Partially working

### 7. Labor Timekeeper — GCP App Engine
- **What:** JCW payroll/timesheet web app
- **Where:** App Engine (version jcw12 serving)
- **Status:** ✅ Running — 275 entries, all approved, <0.3% delta vs PDF truth
- **Issue:** Ephemeral SQLite on App Engine — every version switch = fresh DB restore from GCS
- **Backlog story:** Migrate to persistent VM with Docker

---

## 📋 What's In-Flight (Sprint Board Summary)

**Ready to start:**
- Stabilize Slack Relay (reliable @jcw_service chat)
- Build suite-shell skeleton UI

**In Progress (8 items):**
- GitHub Actions CI/CD matrix workflow
- Repo inventory (partial)
- Suite ops dashboard
- App store UI
- Approval queue + Slack prompts
- 15-min monitor timer
- Payroll reconcile script
- Firestore metrics

**Backlog (needs refinement, 5 items):**
- Office Server Cloud Backup (rclone → GCS)
- Migrate Shared Files to Google Drive
- QuickBooks Migration Assessment
- Labor Timekeeper to Persistent VM
- VM Agent Hardening (24/7 Cline)

---

## 🎯 Recommended Next Actions

1. **Fix OpenClaw** — Update to v2026.2.21-2 and configure rate limit backoff or switch fallback model
2. **Connect to tunnel** — Open https://vscode.dev/tunnel/jcw-dev-server, install Cline, configure with OpenAI/Copilot (not Anthropic)
3. **Update .clinerules model priority** — Reflect the subscription-first strategy above
4. **Consolidate** — You have 4 places where an AI agent could run (local Cline, tunnel Cline, OpenClaw, Slack bot). Pick 2 max:
   - **Primary:** VS Code Tunnel + Cline on VM (24/7, OpenAI/Copilot model)
   - **Secondary:** Slack bot for approvals/monitoring
   - **Pause OpenClaw** until rate limit strategy is sorted
   - **Local Cline** = ad-hoc use when you're at your PC