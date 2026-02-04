# Agent Ops Architecture for GitHub Codespaces

## Executive Summary

This document outlines the architecture for deploying a multi-agent development system using GitHub Codespaces as the persistent runtime environment. The system enables autonomous development, testing, and deployment across the JCW construction tools suite, with labor-timekeeper as the first production implementation.

---

## Strategic Overview

### Current State Analysis

**GitHub Repositories** (github.com/nathangonzalez)
1. **jcw_payroll** ✅ (Active - labor-timekeeper in production)
2. **jcw_financials** (Needs assessment)
3. **jcw-enterprise-suite** (Needs assessment)  
4. **jcw-estimator-pro** (Needs assessment)
5. **jcw_ai_estimator** (Needs assessment)
6. **estimator-backend** (Needs assessment)
7. **mainstreet_migrator** (Excluded - study only)

**Production Status**:
- Labor-timekeeper: ✅ Production (App Engine)
- Email notifications: ✅ Working
- Data persistence: ✅ Fixed
- Test coverage: ~26 tests passing
- CI/CD: ⚠️ Partial (manual deploys)

### Vision: Best-in-Class Custom Suite

**Goal**: Create a unified, production-grade construction management platform

**Components**:
1. **Payroll** (labor-timekeeper) - Time tracking & payroll exports
2. **Financials** - Invoicing, expenses, accounting
3. **Estimating** - AI-powered cost estimation
4. **Project Management** - Job tracking, scheduling
5. **Enterprise Suite** - Unified dashboard and reporting

**Success Metrics**:
- 99.9% uptime across all tools
- <500ms response time
- Daily automated deployments
- 90%+ test coverage
- Zero data loss incidents

---

## Architectural Principles

### 1. Codespaces as Agent Runtime

**Why Codespaces**:
- ✅ Persistent development environment (survives laptop shutdown)
- ✅ GitHub-integrated (native access to repos, issues, PRs)
- ✅ Isolated workspace per agent or per repo
- ✅ Pre-configured dev containers
- ✅ Access to GitHub CLI and Actions
- ✅ Cloud-based (always available)

**Agent Deployment Model**:
```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Codespaces                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Orchestrator │  │ Repo Scout   │  │ Test Agent   │ │
│  │  Codespace   │  │  Codespace   │  │  Codespace   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Code Agent   │  │ QA Agent     │  │ Deploy Agent │ │
│  │  Codespace   │  │  Codespace   │  │  Codespace   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
           │                    │                   │
           ▼                    ▼                   ▼
    ┌─────────────┐      ┌──────────┐       ┌──────────┐
    │  GitHub     │      │ Prod     │       │  GCP     │
    │  Repos      │      │ Servers  │       │ Services │
    └─────────────┘      └──────────┘       └──────────┘
```

### 2. GitHub Actions as Orchestration Layer

**Trigger Model**:
```yaml
# Scheduled workflows
schedule:
  - cron: '0 */4 * * *'  # Every 4 hours (Repo Scout)
  - cron: '0 9 * * 1'    # Monday 9am (Weekly report)
  
# Event-based workflows  
on:
  push:              # Code Agent commits
  pull_request:      # Test/QA agents review
  issues:            # Repo Scout creates issues
  schedule:          # Periodic scans
  workflow_dispatch: # Manual triggers
```

### 3. Hierarchical Agent Structure

**Tier 1: Orchestrator** (Single instance)
- Runs in dedicated Codespace
- Monitors all repos
- Assigns tasks to specialized agents
- Manages approval gates
- Generates reports

**Tier 2: Specialized Agents** (One per domain)
- Repo Scout: Monitors all repos
- Test Agent: Runs test suites
- QA Agent: Validates changes
- Deploy Agent: Manages deployments
- Monitor Agent: Tracks production

**Tier 3: Code Agents** (One per repo)
- Backend Agent (per repo)
- Frontend Agent (per repo)
- Infrastructure Agent (shared)
- Data/Reporting Agent (per repo)

---

## Technical Architecture

### Codespace Configuration

#### Primary Orchestrator Codespace

**Purpose**: Central coordination and human interface

**Configuration**:
```json
// .devcontainer/orchestrator/devcontainer.json
{
  "name": "Agent Ops Orchestrator",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:18",
  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/node:1": {},
    "ghcr.io/devcontainers/features/docker-in-docker:2": {}
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "GitHub.copilot",
        "GitHub.vscode-pull-request-github",
        "ms-vscode.github-actions"
      ]
    }
  },
  "postCreateCommand": "npm install -g @octokit/rest",
  "runArgs": ["--init"],
  "mounts": [
    "source=orchestrator-workspace,target=/workspaces,type=volume"
  ]
}
```

**Capabilities**:
- GitHub API access (via gh CLI)
- Task queue management
- Agent status tracking
- Human notification
- Report generation

#### Repo Scout Codespace

**Purpose**: Repository monitoring and issue discovery

**Configuration**:
```json
// .devcontainer/repo-scout/devcontainer.json
{
  "name": "Repo Scout Agent",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:18",
  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/node:1": {}
  },
  "postCreateCommand": "npm install -g npm-check-updates eslint",
  "mounts": [
    "source=repo-scout-cache,target=/home/node/.cache,type=volume"
  ]
}
```

**Monitoring Tasks**:
- CI/CD status checks
- Dependency vulnerability scans
- Test coverage tracking
- Code quality metrics
- Issue triage

#### Code Agent Codespace (Template)

**Purpose**: Development work per repository

**Configuration**:
```json
// .devcontainer/code-agent/devcontainer.json
{
  "name": "Code Agent - ${REPO_NAME}",
  "build": {
    "dockerfile": "Dockerfile",
    "context": ".."
  },
  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/node:1": {},
    "ghcr.io/devcontainers/features/python:1": {}
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "ms-playwright.playwright"
      ]
    }
  },
  "postCreateCommand": "npm install && npm test",
  "forwardPorts": [3000, 8080],
  "mounts": [
    "source=${REPO_NAME}-workspace,target=/workspaces,type=volume"
  ]
}
```

---

## Workflow Architecture

### 1. Continuous Monitoring Loop

```yaml
# .github/workflows/repo-scout.yml
name: Repo Scout Agent

on:
  schedule:
    - cron: '0 */4 * * *'  # Every 4 hours
  workflow_dispatch:

jobs:
  scan-repos:
    runs-on: ubuntu-latest
    steps:
      - name: Scan All Repos
        run: |
          # Use GitHub API to check repo health
          # Create issues for failures
          # Update metrics dashboard
          
      - name: Dependency Check
        run: |
          # Run npm audit across all repos
          # Check for security vulnerabilities
          # Create PRs for safe updates
          
      - name: Coverage Analysis
        run: |
          # Collect test coverage reports
          # Identify gaps
          # Create improvement tasks
```

### 2. Autonomous Development Loop

```yaml
# .github/workflows/code-agent.yml
name: Code Agent

on:
  issues:
    types: [labeled]  # Label: 'agent-task'
  workflow_dispatch:

jobs:
  implement-feature:
    runs-on: ubuntu-latest
    if: contains(github.event.issue.labels.*.name, 'agent-task')
    steps:
      - name: Claim Task
        run: |
          # Comment on issue claiming task
          # Move to 'In Progress' on project board
          
      - name: Create Branch
        run: |
          # Create feature branch
          # Fetch issue details
          
      - name: Implement Changes
        run: |
          # Generate code based on issue description
          # Run tests
          # Fix failures
          
      - name: Create PR
        run: |
          # Push branch
          # Create PR with checklist
          # Request reviews from Test & QA agents
```

### 3. Test & QA Pipeline

```yaml
# .github/workflows/test-agent.yml
name: Test Agent

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  validate-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run Test Suite
        run: |
          npm test
          npm run test:e2e
          
      - name: Coverage Check
        run: |
          # Verify coverage requirements met
          # Comment coverage report on PR
          
      - name: Performance Tests
        run: |
          # Run performance benchmarks
          # Compare against baseline
          
      - name: Approve or Request Changes
        run: |
          # Auto-approve if all gates pass
          # Request changes if failures
```

### 4. Deployment Pipeline

```yaml
# .github/workflows/deploy-agent.yml
name: Deploy Agent

on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  deploy-production:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - name: Pre-flight Checks
        run: |
          # Verify all tests passed
          # Check for breaking changes
          # Validate deployment config
          
      - name: Deploy to Production
        run: |
          # Deploy to App Engine
          # Run smoke tests
          # Monitor for 15 minutes
          
      - name: Post-Deploy Validation
        run: |
          # Check health endpoints
          # Verify metrics normal
          # Alert if issues detected
          
      - name: Rollback if Needed
        if: failure()
        run: |
          # Automatic rollback
          # Create incident report
          # Notify human
```

---

## Data Flow & Communication

### Agent Communication Protocol

**Channel 1: GitHub Issues**
- Task creation and assignment
- Status updates
- Blocker reporting
- Human escalation

**Channel 2: PR Comments**
- Code review feedback
- Test results
- Agent handoffs
- Approval gates

**Channel 3: GitHub Projects**
- Task board management
- Progress tracking
- Priority queues
- Sprint planning

**Channel 4: Workflow Artifacts**
- Test reports
- Coverage data
- Performance metrics
- Deployment logs

### State Management

**Persistent Storage**:
```
agent-ops/
├── state/
│   ├── orchestrator/
│   │   ├── task-queue.json
│   │   ├── agent-status.json
│   │   └── metrics.json
│   ├── repo-scout/
│   │   ├── scan-results.json
│   │   └── issue-tracker.json
│   └── agents/
│       ├── labor-timekeeper/
│       │   ├── progress.json
│       │   └── test-results.json
│       └── [other-repos]/
└── logs/
    ├── agent-actions.log
    ├── deployments.log
    └── incidents.log
```

**GitHub Artifacts**:
- Stored per workflow run
- 90-day retention
- Downloadable for analysis
- Used for metrics

---

## Security Architecture

### Access Control

**GitHub App vs Personal Access Token**:

**Recommended: GitHub App** ✅
- Fine-grained permissions
- Scoped to specific repos
- Auditable actions
- Can be reviewed/revoked easily

**Configuration**:
```yaml
# GitHub App Permissions
repos: write         # Create branches, PRs
issues: write        # Manage issues
checks: write        # Update check runs
workflows: write     # Trigger workflows
contents: write      # Push code
pull_requests: write # Review PRs
```

### Secret Management

**Secrets Hierarchy**:
1. **GitHub Secrets** (per repo)
   - GCP credentials
   - API keys
   - Deploy tokens

2. **Codespace Secrets** (per workspace)
   - Development credentials
   - Test API keys
   - Local config

3. **GCP Secret Manager** (production)
   - SMTP credentials
   - Database passwords
   - Third-party API keys

### Audit Trail

**Logging Requirements**:
- All agent actions logged
- PR/commit attribution
- Deployment history
- Failure analysis
- Human override tracking

---

## Deployment Strategy

### Phase 1: Labor-Timekeeper (Weeks 1-4)

**Goals**:
- Prove agent architecture on production app
- Establish CI/CD automation
- Build confidence in system

**Deliverables**:
1. Codespace configurations
2. GitHub Actions workflows
3. Automated testing
4. Deployment pipeline
5. Monitoring dashboard

**Success Criteria**:
- 5 autonomous PRs merged
- Zero production incidents
- Daily deployments
- 90% test coverage

### Phase 2: Multi-Repo Expansion (Weeks 5-12)

**Target Repos** (Priority order):
1. jcw_ai_estimator (AI estimation tool)
2. jcw_financials (Financial management)
3. jcw-estimator-pro (Advanced estimating)
4. jcw-enterprise-suite (Unified platform)

**Per-Repo Rollout**:
- Week 1: Assessment & planning
- Week 2: CI/CD setup
- Week 3: Agent deployment
- Week 4: Validation & optimization

### Phase 3: Unified Platform (Weeks 13-20)

**Integration Points**:
- Shared authentication
- Common API gateway
- Unified database (where applicable)
- Cross-tool workflows
- Centralized reporting

---

## Recommendations

### Immediate Actions (Week 1)

1. **Create Orchestrator Codespace** ✅
   - Clone jcw_payroll repo
   - Set up devcontainer
   - Install gh CLI
   - Configure GitHub App

2. **Deploy Repo Scout**
   - Create workflow
   - Scan all nathangonzalez repos
   - Generate health report
   - Identify quick wins

3. **Establish Baselines**
   - Current test coverage
   - Deployment frequency
   - Incident rate
   - Manual effort hours

4. **Set Up Monitoring**
   - GitHub Actions dashboard
   - Production health checks
   - Agent activity metrics
   - Cost tracking

### Short-Term (Weeks 2-4)

1. **Automate Testing**
   - Expand Playwright suite
   - Add performance tests
   - Create coverage gates
   - Fix flaky tests

2. **Build Deployment Pipeline**
   - Staging environment
   - Blue-green deploys
   - Automatic rollback
   - Smoke tests

3. **Create First Code Agent**
   - Focus on labor-timekeeper
   - Small, safe changes
   - Well-tested PRs
   - Human review required

4. **Measure & Iterate**
   - Track agent performance
   - Refine workflows
   - Optimize costs
   - Gather feedback

### Medium-Term (Weeks 5-12)

1. **Scale to Multiple Repos**
   - Standardize repo structure
   - Share common components
   - Coordinate deployments
   - Cross-repo testing

2. **Enhance Agent Capabilities**
   - Natural language understanding
   - Better code generation
   - Smarter prioritization
   - Reduced human intervention

3. **Build Shared Infrastructure**
   - Common API patterns
   - Unified auth system
   - Shared UI components
   - Centralized logging

### Long-Term (Weeks 13+)

1. **Advanced Features**
   - Predictive maintenance
   - Self-healing systems
   - AI-powered optimization
   - Business intelligence

2. **Cross-Tool Integration**
   - Unified dashboard
   - Automated workflows
   - Real-time sync
   - Consolidated reporting

---

## Cost Analysis

### GitHub Codespaces

**Tier**: 4-core (recommended)
- $0.36/hour active
- ~40 hours/week per agent
- 7 agents initially
- **~$100/week = $400/month**

**Optimization**:
- Suspend when idle (auto after 30 min)
- Use pre-builds for fast startup
- Share workspaces where possible
- Scale down non-critical agents

### GitHub Actions

**Usage**: ~10,000 minutes/month
- Pro plan: ~$4/user/month
- Additional minutes: $0.008/min
- **~$20/month**

### Total Monthly Cost

```
GitHub Codespaces:  $400
GitHub Actions:     $ 20
GitHub Pro:         $  4
GCP (existing):     $200
────────────────────────
Total:              $624/month
```

**ROI Calculation**:
- Developer time saved: ~80 hours/month
- At $50/hour: $4,000/month value
- **ROI: 540%**

---

## Risk Mitigation

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Agent breaks production | Medium | High | Mandatory tests, human approval, auto-rollback |
| Codespace downtime | Low | Medium | Multi-region, local fallback capability |
| Cost overrun | Medium | Low | Usage alerts, auto-suspend, budget caps |
| Agent conflicts | Low | Medium | Clear task dependencies, orchestrator |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Over-reliance on agents | Medium | Medium | Regular human reviews, manual override |
| Knowledge loss | Low | High | Comprehensive docs, decision logs |
| Security breach | Low | High | Least-privilege access, audit logs |

---

## Success Metrics

### Technical Metrics

- **Deployment Frequency**: Daily (target: 10x current)
- **Lead Time**: <4 hours (idea → production)
- **Mean Time to Recovery**: <15 minutes
- **Test Coverage**: >90%
- **Build Success Rate**: >95%

### Business Metrics

- **Development Velocity**: 5x increase
- **Bug Escape Rate**: <1% (down from ~5%)
- **Uptime**: >99.9%
- **Customer Satisfaction**: >4.5/5

### Agent Performance

- **Autonomous Task Completion**: 80%
- **PR Approval Rate**: >90%
- **Time to Human Review**: <24 hours
- **Agent Utilization**: >60%

---

## Next Steps

### Immediate (This Week)

1. ✅ Complete documentation
2. [ ] Create orchestrator Codespace
3. [ ] Deploy first GitHub Action workflow
4. [ ] Scan all repos with Repo Scout
5. [ ] Generate baseline metrics report

### Week 2

1. [ ] Set up automated testing pipeline
2. [ ] Create first Code Agent PR
3. [ ] Establish deployment automation
4. [ ] Implement monitoring dashboard
5. [ ] Weekly status report to human

### Week 3-4

1. [ ] Scale testing infrastructure
2. [ ] Deploy QA automation
3. [ ] Full deployment pipeline
4. [ ] Multi-agent coordination
5. [ ] Phase 1 completion review

---

**Last Updated**: 2026-02-04  
**Version**: 1.0  
**Status**: Architecture defined, ready for implementation  
**Next Review**: 2026-02-11
