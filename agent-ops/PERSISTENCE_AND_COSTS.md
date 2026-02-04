# Persistence & Cost Management

## TL;DR

✅ **Yes, agents run in cloud VMs (GitHub Codespaces) and continue when you close your PC**  
✅ **Auto-fallback to free models when budget limit reached**

---

## Persistence: How Agents Keep Running

### GitHub Codespaces = Cloud VM

**What is it?**
- GitHub Codespaces is a **cloud-based VM** running in Microsoft Azure
- It's NOT dependent on your local computer
- Think of it as a remote computer that stays on 24/7

**How it works**:
```
Your PC (Laptop/Desktop)          GitHub Codespaces (Cloud VM)
┌──────────────────┐              ┌─────────────────────────┐
│  You close lid   │              │   Agents keep running   │
│  Go to sleep     │ ────X────>   │   in the cloud          │
│  Shut down       │              │   Independent of you    │
└──────────────────┘              └─────────────────────────┘
                                           │
                                           ├─> GitHub Actions
                                           ├─> Runs tests
                                           ├─> Creates PRs
                                           └─> Deploys code
```

### Codespace Lifecycle

**Default Behavior**:
- **Idle timeout**: 30 minutes (pauses if no activity)
- **Max lifetime**: 30 days
- **Your PC**: Completely independent - close anytime

**Keeping Agents Active**:
```json
// .devcontainer/devcontainer.json
{
  "settings": {
    "codespaces.idleTimeout": "4h"  // Stay active for 4 hours
  }
}
```

**Or Use GitHub Actions** (Recommended):
- Agents trigger via scheduled workflows
- No need for persistent Codespace
- Only runs when needed (cost-effective)
- Can run 24/7 on schedule

```yaml
# Runs every 4 hours, even if your PC is off
schedule:
  - cron: '0 */4 * * *'
```

### Persistence Levels

| Level | Method | PC Required? | Cost |
|-------|--------|--------------|------|
| **Level 1** | GitHub Actions (scheduled) | ❌ No | Free tier: 2000 min/month |
| **Level 2** | Codespace (4-hour idle) | ❌ No | $0.36/hour active |
| **Level 3** | Codespace (always-on) | ❌ No | $0.36/hour × 24 × 30 = $259/month |

**Recommendation**: Level 1 (GitHub Actions) for most agents, Level 2 for orchestrator

---

## Cost Management & Free Model Fallback

### Problem Statement

**Current Setup**:
- Labor-timekeeper uses OpenAI API for voice transcription
- OpenAI costs money per API call
- Risk: Budget exhaustion = system stops

**Solution**:
- Monitor API costs in real-time
- Auto-switch to free alternatives when limits hit
- Graceful degradation (reduced features, not complete failure)

### Cost Monitoring

#### 1. Budget Configuration

```javascript
// agent-ops/config/budget.json
{
  "monthly_budget": {
    "total": 100.00,          // $100/month total
    "openai": 50.00,          // $50 for OpenAI
    "github": 20.00,          // $20 for GitHub Actions/Codespaces
    "gcp": 30.00              // $30 for GCP services
  },
  "alerts": {
    "warning_threshold": 0.75,  // Alert at 75%
    "critical_threshold": 0.90, // Critical at 90%
    "cutoff_threshold": 1.00    // Switch to free at 100%
  },
  "fallback_enabled": true
}
```

#### 2. Cost Tracking System

```javascript
// agent-ops/lib/cost-monitor.js
class CostMonitor {
  constructor() {
    this.budget = require('../config/budget.json');
    this.currentSpend = this.loadCurrentSpend();
  }

  async checkOpenAICost() {
    const usage = await this.getOpenAIUsage();
    const percentUsed = usage / this.budget.monthly_budget.openai;
    
    if (percentUsed >= this.budget.alerts.cutoff_threshold) {
      console.warn('🚨 OpenAI budget exhausted - switching to free model');
      return 'FREE_MODEL';
    } else if (percentUsed >= this.budget.alerts.critical_threshold) {
      console.warn('⚠️ OpenAI budget at 90% - consider free model');
      return 'PAID_MODEL_WARNING';
    }
    return 'PAID_MODEL';
  }

  async getOpenAIUsage() {
    // Query OpenAI API for current month usage
    // Or track locally in SQLite
    const response = await fetch('https://api.openai.com/v1/usage', {
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    return response.json();
  }
}

module.exports = new CostMonitor();
```

### Free Model Alternatives

#### AI Model Hierarchy

```javascript
// agent-ops/config/models.json
{
  "voice_transcription": {
    "tier_1_paid": {
      "provider": "openai",
      "model": "whisper-1",
      "cost_per_minute": 0.006,
      "quality": "excellent"
    },
    "tier_2_paid": {
      "provider": "google_cloud",
      "model": "speech-to-text",
      "cost_per_minute": 0.004,
      "quality": "good"
    },
    "tier_3_free": {
      "provider": "browser_api",
      "model": "Web Speech API",
      "cost_per_minute": 0.000,
      "quality": "fair",
      "limitations": "Requires browser, shorter audio"
    }
  },
  "code_generation": {
    "tier_1_paid": {
      "provider": "openai",
      "model": "gpt-4-turbo",
      "cost_per_1k_tokens": 0.01,
      "quality": "excellent"
    },
    "tier_2_paid": {
      "provider": "anthropic",
      "model": "claude-3-sonnet",
      "cost_per_1k_tokens": 0.003,
      "quality": "excellent"
    },
    "tier_3_free": {
      "provider": "local_ollama",
      "model": "codellama:34b",
      "cost_per_1k_tokens": 0.000,
      "quality": "good",
      "limitations": "Requires local GPU or CPU, slower"
    },
    "tier_4_free": {
      "provider": "huggingface",
      "model": "starcoder",
      "cost_per_1k_tokens": 0.000,
      "quality": "fair",
      "limitations": "Rate limited, quality varies"
    }
  }
}
```

#### Free Model Options

**1. Ollama (Local/Free)**
```bash
# Run locally or in Codespace
curl https://ollama.ai/install.sh | sh
ollama pull codellama:34b
ollama pull llama2:70b

# Use in code
const response = await fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  body: JSON.stringify({
    model: 'codellama:34b',
    prompt: 'Generate a function to...'
  })
});
```

**Pros**:
- ✅ Completely free
- ✅ No API limits
- ✅ Privacy (data stays local)

**Cons**:
- ❌ Slower than cloud APIs
- ❌ Requires CPU/GPU resources
- ❌ Quality slightly lower than GPT-4

**2. Hugging Face Inference API (Free Tier)**
```javascript
// 30,000 free characters/month
const response = await fetch(
  'https://api-inference.huggingface.co/models/bigcode/starcoder',
  {
    headers: { Authorization: `Bearer ${HF_TOKEN}` },
    method: 'POST',
    body: JSON.stringify({ inputs: 'def hello():' })
  }
);
```

**3. GitHub Copilot (Included with GitHub Pro)**
- If you have GitHub Pro ($4/month), Copilot is included
- Can use for code generation
- Not exactly free, but part of existing GitHub costs

### Automatic Fallback System

```javascript
// agent-ops/lib/model-selector.js
const CostMonitor = require('./cost-monitor');
const models = require('../config/models.json');

class ModelSelector {
  async selectModel(task) {
    const costStatus = await CostMonitor.checkOpenAICost();
    const taskModels = models[task];

    switch(costStatus) {
      case 'PAID_MODEL':
        return taskModels.tier_1_paid;
      
      case 'PAID_MODEL_WARNING':
        // Still use paid, but log warning
        console.warn('⚠️ Approaching budget limit');
        return taskModels.tier_1_paid;
      
      case 'FREE_MODEL':
        // Switch to free alternative
        console.log('💰 Using free model to stay within budget');
        return taskModels.tier_3_free || taskModels.tier_4_free;
      
      default:
        return taskModels.tier_1_paid;
    }
  }

  async generateCode(prompt) {
    const model = await this.selectModel('code_generation');
    
    if (model.provider === 'openai') {
      return this.callOpenAI(prompt, model);
    } else if (model.provider === 'local_ollama') {
      return this.callOllama(prompt, model);
    } else if (model.provider === 'huggingface') {
      return this.callHuggingFace(prompt, model);
    }
  }

  async callOpenAI(prompt, model) {
    // Existing OpenAI implementation
  }

  async callOllama(prompt, model) {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        model: model.model,
        prompt: prompt,
        stream: false
      })
    });
    return response.json();
  }

  async callHuggingFace(prompt, model) {
    // Hugging Face implementation
  }
}

module.exports = new ModelSelector();
```

### Cost Dashboard

```javascript
// agent-ops/scripts/cost-dashboard.js
const CostMonitor = require('../lib/cost-monitor');

async function generateReport() {
  const budget = require('../config/budget.json');
  const current = await CostMonitor.getCurrentSpend();

  console.log(`
╔════════════════════════════════════════════════════════╗
║          Agent Ops - Cost Dashboard                    ║
╚════════════════════════════════════════════════════════╝

Monthly Budget:     $${budget.monthly_budget.total}
Current Spend:      $${current.total}
Remaining:          $${(budget.monthly_budget.total - current.total).toFixed(2)}
% Used:             ${((current.total / budget.monthly_budget.total) * 100).toFixed(1)}%

Breakdown:
  OpenAI:           $${current.openai} / $${budget.monthly_budget.openai}
  GitHub:           $${current.github} / $${budget.monthly_budget.github}
  GCP:              $${current.gcp} / $${budget.monthly_budget.gcp}

Current Mode:       ${current.mode}
Model in Use:       ${current.active_model}

Projected End of Month: $${current.projected}
  `);

  if (current.total / budget.monthly_budget.total > 0.9) {
    console.log('🚨 WARNING: Budget critically low - using free models');
  } else if (current.total / budget.monthly_budget.total > 0.75) {
    console.log('⚠️  CAUTION: 75% of budget used');
  } else {
    console.log('✅ Budget healthy');
  }
}

generateReport();
```

### GitHub Actions Integration

```yaml
# .github/workflows/cost-monitor.yml
name: Cost Monitor

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  check-costs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Check Budget Status
        run: |
          node agent-ops/scripts/cost-dashboard.js
          
      - name: Send Alert if Over Budget
        if: ${{ steps.check.outputs.over_budget == 'true' }}
        run: |
          # Send email or create GitHub issue
          gh issue create \
            --title "⚠️ Agent Ops Budget Alert" \
            --body "Budget limit reached. Switched to free models." \
            --label "agent-ops,budget-alert"
```

---

## Recommended Setup for Your Use Case

### For Always-On Operations (Even When PC Off)

**Option A: GitHub Actions (Recommended - Most Cost Effective)**

```yaml
# .github/workflows/agent-ops-nightly.yml
name: Agent Ops Nightly

on:
  schedule:
    # Runs every 4 hours - works even if your PC is off
    - cron: '0 */4 * * *'
  workflow_dispatch:  # Manual trigger anytime

jobs:
  run-agents:
    runs-on: ubuntu-latest
    steps:
      - name: Repo Scout
        run: |
          # Scan repos for issues
          # Create tasks for other agents
          
      - name: Process Tasks
        run: |
          # Code generation
          # Test execution
          # Create PRs
```

**Cost**: Free (2000 minutes/month free tier, ~$0.008/min after)

**Option B: Long-Running Codespace**

```json
// .devcontainer/devcontainer.json
{
  "settings": {
    "codespaces.idleTimeout": "240"  // 4 hours
  },
  "postStartCommand": "node agent-ops/orchestrator/start.js"
}
```

**Cost**: $0.36/hour × hours active per month

### Budget Configuration

```javascript
// agent-ops/config/budget.json
{
  "monthly_budget": {
    "total": 50.00,           // Adjust to your budget
    "openai": 20.00,          // Voice & AI features
    "github": 10.00,          // Codespaces/Actions
    "gcp": 20.00              // Production hosting
  },
  "fallback_enabled": true,   // Auto-switch to free models
  "alert_email": "your@email.com"
}
```

---

## Implementation Checklist

### Phase 1: Persistence Setup
- [ ] Create GitHub Actions workflows for scheduled runs
- [ ] Configure Codespace auto-start settings
- [ ] Set up orchestrator to run on schedule
- [ ] Test: Close your PC, verify agents keep running

### Phase 2: Cost Monitoring
- [ ] Create cost monitoring system
- [ ] Set up budget alerts
- [ ] Configure model hierarchy
- [ ] Install Ollama for free fallback

### Phase 3: Automatic Fallback
- [ ] Implement model selector logic
- [ ] Test OpenAI → Ollama switch
- [ ] Create cost dashboard
- [ ] Set up budget alert notifications

### Phase 4: Validation
- [ ] Run for 1 week, monitor costs
- [ ] Verify fallback triggers correctly
- [ ] Confirm agents work when PC off
- [ ] Optimize for cost efficiency

---

## FAQ

**Q: Will the agents literally run 24/7?**  
A: They CAN, but we recommend scheduled runs (every 4-6 hours) to save costs. Agents wake up, do work, then sleep.

**Q: What happens if I completely run out of money?**  
A: System switches to 100% free models (Ollama, Hugging Face free tier). Quality slightly lower but keeps running.

**Q: Can I turn off agents manually?**  
A: Yes! Disable GitHub Actions workflows or pause/delete Codespaces anytime.

**Q: What if GitHub/Azure has an outage?**  
A: Agents pause until service restored. Your production app (on GCP) is independent and keeps running.

**Q: How do I check on agents remotely?**  
A: View GitHub Actions runs, check PR activity, or get email reports. All visible from any device.

---

**Last Updated**: 2026-02-04  
**Version**: 1.0  
**Status**: Cost management system designed, ready to implement
