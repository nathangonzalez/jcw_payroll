# JCW Agent Ops — Training Guide
*Last updated: 2026-02-23*

---

## 🎯 The Big Picture

You're building a **multi-agent development system** for JCW. Think of it as having a team of AI developers that can work while you sleep. Here's the honest state of things:

### What's Running 24/7 Right Now

| System | 24/7? | What It Does | How You Interact |
|--------|-------|-------------|-----------------|
| **VS Code Tunnel** | ✅ Yes | VS Code on VM, accessible from any device | Open https://vscode.dev/tunnel/jcw-dev-server |
| **Cline (in tunnel)** | ⚠️ Standby | AI coding assistant on VM | Open tunnel → start a conversation with Cline |
| **Slack Bot (Clawbot)** | ✅ Yes | Message relay, kill switch, status | Message @jcw_service in Slack |
| **GitHub Actions** | ✅ Yes | Scheduled story generation, CI/CD | Runs automatically on cron schedule |
| **Labor Timekeeper** | ✅ Yes | Payroll web app | https://jcw-2-android-estimator.uc.r.appspot.com |
| **code-server** | ✅ Yes | Backup VS Code web access | http://34.31.213.200:8080 |

### What's NOT Running 24/7 (Yet)

| System | Status | Why |
|--------|--------|-----|
| **OpenClaw** | 🔴 Broken | Rate-limited on Copilot, needs config fix |
| **Cline (local)** | Only when PC is on | Runs in your local VS Code |
| **Auto-task agent** | ❌ Doesn't exist yet | No one picks up tasks from the backlog automatically |

### The Key Insight

**Infrastructure = 24/7. Agents = on-demand.**

The tunnel, bot, and GitHub Actions run continuously. But the AI agents (Cline, OpenClaw) still need **you** to start a task. They don't autonomously pick up work from the sprint board. That's a future capability.

---

## 📱 Mobile Coding with VS Code Tunnel

The VS Code Tunnel is your **primary tool for coding from anywhere** — phone, tablet, any browser.

### How to Use It

1. **Open** https://vscode.dev/tunnel/jcw-dev-server on any device
2. **Sign in** with your GitHub account
3. **Open folder** → `/home/nathan/dev/repos/jcw_payroll` (or `agent-ops`)
4. **Code normally** — terminal, extensions, Cline all work
5. **Close the tab** when done — the VM keeps running

### What Makes It Different From Local VS Code

| Feature | Local VS Code | Tunnel (VM) |
|---------|--------------|-------------|
| Where code runs | Your PC | GCP VM (clawbot-ops) |
| Survives laptop close | ❌ No | ✅ Yes |
| Works from phone | ❌ No | ✅ Yes |
| Cline can run overnight | ❌ No | ✅ Yes (if task started) |
| Git repos | Your PC copies | VM copies |
| Performance | Your PC specs | VM: 4GB RAM, 2 vCPU |

### Pro Tips
- **Bookmark** the URL for quick access
- **Don't panic** if you see "Timeout connecting to relay" — just refresh. TCP keepalive is set to 60s which should prevent most disconnects
- **Use VS Code Desktop** for best experience: Ctrl+Shift+P → "Remote-Tunnels: Connect to Tunnel" → `jcw-dev-server`

---

## 🤖 Slack Bot (Clawbot)

The Slack bot (`@jcw_service` in #jcw_bot) is your **remote control** for the agent system.

### Commands

| Command | What It Does |
|---------|-------------|
| `@jcw_service status` | Reports bot status and pause state |
| `/kill` or `STOP ALL` | Emergency stop — pauses all agent operations |
| `resume` or `/resume` | Unpauses the bot |
| `@jcw_service approve: <task>` | Approves a pending task |

### When to Use Slack vs Tunnel

| Situation | Use |
|-----------|-----|
| Quick status check | Slack: `@jcw_service status` |
| Emergency stop | Slack: `/kill` |
| Writing code | Tunnel: vscode.dev |
| Reviewing code | Tunnel: vscode.dev |
| Approving tasks | Slack: approve buttons |
| Monitoring | Slack: bot posts updates every 4h |

---

## 🦞 OpenClaw (Currently Down)

OpenClaw is a **multi-agent orchestrator** — it manages 8 specialized AI agents:
- **Orchestrator** — assigns tasks to sub-agents
- **Research** — generates research stories
- **Coder** — writes code
- **QA** — tests code
- **Release** — deploys code
- **Analyst** — data analysis
- **Finance** — financial calculations
- **Scout** — repo monitoring

### Current Status: 🔴 Rate-Limited

OpenClaw routes through your Copilot subscription (openai/gpt-4.1), which has rate limits. The agents hammer the API with no backoff → infinite retry loop.

### To Fix:
1. Run `openclaw doctor` and accept the gateway config update
2. Run `openclaw gateway restart`
3. Consider configuring a fallback model in `agent-ops/openclaw.json`

### When OpenClaw Works, It's Powerful
It can autonomously: research topics, write code, run tests, and propose PRs. But it needs a working model connection first.

---

## 🧠 Model Strategy (Your AI Budget)

| Priority | Model | Cost | Use For |
|----------|-------|------|---------|
| 1 | **OpenAI/Copilot** | ✅ Subscription | Primary coding (has rate limits) |
| 2 | **Cline M2** | ✅ Free | Light tasks, routine checks |
| 3 | **Gemini Flash** | 💰 ~$0.08/1M tokens | Simple tasks, cheap fallback |
| 4 | **Gemini 2.5 Pro** | 💰 Moderate | Large context tasks |
| 5 | **Anthropic Sonnet** | 💰💰 $3/1M tokens | Last resort |

**Rule of thumb:** Use subscription (free) first. Free models second. Pay-per-token = emergency only.

---

## 📋 GitHub Actions (Automated Workflows)

These run on a schedule without any human intervention:

| Workflow | Schedule | What It Does |
|----------|----------|-------------|
| `story-generator.yml` | 8AM + 4PM EST | Generates AI research stories |
| `research-digest.yml` | 6AM daily + Mon 7AM | Summarizes research findings |
| `deploy-slackbot.yml` | Manual only | Deploys Slack bot to Cloud Run |

### How to Trigger Manually
1. Go to https://github.com/nathangonzalez/jcw-agent-ops/actions
2. Click the workflow
3. Click "Run workflow"

---

## 🔧 How Everything Connects

```
┌─────────────────────────────────────────────┐
│                YOUR DEVICES                  │
│  Phone / Laptop / Tablet                     │
│                                              │
│  ┌─────────────┐  ┌────────────────────┐    │
│  │   Slack      │  │   Browser/VS Code  │    │
│  │   @jcw_srv   │  │   vscode.dev/      │    │
│  │             │  │   tunnel/jcw-dev    │    │
│  └──────┬──────┘  └────────┬───────────┘    │
└─────────┼──────────────────┼────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────────────────────────────────┐
│           GCP VM: clawbot-ops                │
│           (runs 24/7, 4GB RAM)               │
│                                              │
│  ┌──────────────┐  ┌───────────────────┐    │
│  │ clawbot.svc  │  │ code-tunnel.svc   │    │
│  │ (Slack bot)  │  │ (VS Code server)  │    │
│  └──────────────┘  └───────────────────┘    │
│                                              │
│  ┌──────────────┐  ┌───────────────────┐    │
│  │ code-server  │  │ Cline extension   │    │
│  │ (backup:8080)│  │ (in tunnel)       │    │
│  └──────────────┘  └───────────────────┘    │
│                                              │
│  Repos: /home/nathan/dev/repos/              │
│    ├── jcw_payroll                           │
│    └── agent-ops                             │
└─────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│              CLOUD SERVICES                  │
│                                              │
│  ┌──────────────┐  ┌───────────────────┐    │
│  │ GitHub       │  │ GCP App Engine    │    │
│  │ Actions      │  │ Labor Timekeeper  │    │
│  │ (CI/CD)      │  │ (jcw12)           │    │
│  └──────────────┘  └───────────────────┘    │
│                                              │
│  ┌──────────────┐  ┌───────────────────┐    │
│  │ GCP Secret   │  │ GCS Bucket        │    │
│  │ Manager      │  │ DB backups        │    │
│  └──────────────┘  └───────────────────┘    │
└─────────────────────────────────────────────┘
```

---

## 🎓 Daily Workflow — How to Use This System

### Morning (from phone or PC)
1. Check **Slack #jcw_bot** for overnight updates
2. Open **vscode.dev/tunnel/jcw-dev-server** if you need to code
3. Check **GitHub Actions** for any failed workflows

### During the Day (on the go)
1. **Quick code fix?** → Open tunnel on phone, make the edit, commit
2. **Need research?** → Ask Cline in the tunnel
3. **Emergency stop?** → Slack: `/kill`
4. **Check payroll?** → Open the Labor Timekeeper app

### Evening / Before Bed
1. Start a long-running Cline task in the tunnel (e.g., "refactor this module")
2. Close your laptop — the VM keeps working
3. Check results in the morning

### Weekend
- GitHub Actions run stories on schedule
- Slack bot monitors and reports
- You check in when you feel like it

---

## ❓ FAQ

**Q: If I close my laptop, does the tunnel keep running?**
A: Yes. The tunnel is a systemd service on the VM. It runs 24/7.

**Q: Can Cline work while I sleep?**
A: Only if you started a task before sleeping. Cline needs an open conversation to work. It doesn't pick up tasks from a queue (yet).

**Q: What's the difference between code-server and the tunnel?**
A: Code-server (port 8080) is a separate web VS Code instance. The tunnel connects to vscode.dev using Microsoft's relay. Tunnel is better — full extension support, including Cline config buttons.

**Q: How much does this cost?**
A: The VM is ~$25/month (e2-medium). Anthropic API is pay-per-use. OpenAI is subscription. GitHub Actions has free tier (2000 min/month).

**Q: What if something breaks at 3AM?**
A: The Slack bot will post errors immediately. Clawbot service auto-restarts. The tunnel auto-restarts. Most things recover on their own.

**Q: Is my code safe?**
A: Yes. Everything is git-tracked and backed up. The `.clinerules` file prevents destructive operations. The kill switch stops everything instantly.