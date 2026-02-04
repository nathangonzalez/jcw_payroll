# Agent Ops - Multi-Agent Development System

## Overview

Agent Ops is a multi-agent autonomous development system designed to enable continuous software development, testing, and deployment across the JCW construction tools suite while the human is away.

## Vision

Create a self-sustaining development environment where specialized AI agents work collaboratively to:
- Continuously improve and maintain production systems
- Develop new features autonomously
- Run comprehensive tests and quality checks
- Deploy changes safely with human approval gates
- Monitor and respond to issues proactively

## Architecture

The system consists of specialized agents orchestrated through GitHub Actions and Codespaces:

1. **Orchestrator Agent** - Manages task prioritization and agent coordination
2. **Repo Scout Agent** - Monitors repository health and identifies work items
3. **Code Agent (Specialized)** - Implements features and fixes
4. **Test Agent** - Validates changes through automated testing
5. **QA Agent** - Performs regression and integration testing
6. **Deploy Agent** - Manages deployments and rollbacks
7. **Expert Agent** - Construction management domain expert providing strategic guidance
8. **Monitor Agent** - Tracks production health and alerts

## Current Status

- ✅ Foundation documentation created
- ✅ Codespaces configuration ready
- 🔄 Agent role definitions in progress
- 🔄 Workflow automation in development
- ⏳ GitHub Actions integration pending
- ⏳ Production deployment pipeline pending

## Quick Start

1. **For Humans**: Review [AGENT_ROLES.md](./AGENT_ROLES.md) to understand agent responsibilities
2. **For Agents**: Follow [WORKFLOW.md](./WORKFLOW.md) for task execution
3. **For Operations**: Reference [RUNBOOK.md](./RUNBOOK.md) for troubleshooting

## Key Principles

- **Human-in-the-Loop**: All production changes require human approval
- **Test-First**: Every change must pass automated tests
- **Incremental**: Small, focused PRs over large rewrites
- **Observable**: All agent actions are logged and traceable
- **Reversible**: Quick rollback capability for any deployment

## Documentation

- [Agent Roles](./AGENT_ROLES.md) - Detailed agent responsibilities
- [Workflow](./WORKFLOW.md) - Development process and protocols
- [Roadmap](./ROADMAP.md) - Implementation phases and timeline
- [Runbook](./RUNBOOK.md) - Operational procedures

## Support

For questions or issues:
1. Review documentation first
2. Check [persist.txt](../labor-timekeeper/persist.txt) for project context
3. Create an issue in the repo with `[agent-ops]` tag

---

**Last Updated**: 2026-02-04  
**Status**: Phase 0 - Foundation
