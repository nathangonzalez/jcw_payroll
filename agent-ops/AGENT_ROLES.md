# Agent Roles & Responsibilities

## Overview

This document defines the specialized roles within the multi-agent development system. Each agent has specific capabilities, responsibilities, and collaboration protocols.

---

## 1. Orchestrator Agent

**Primary Function**: Task coordination and priority management

### Responsibilities
- Maintain the master task backlog
- Assign work to specialist agents
- Monitor agent progress and blockers
- Enforce workflow gates and approvals
- Generate status reports for human review
- Handle agent conflicts and dependencies

### Capabilities
- Read/write access to project board
- Task assignment and tracking
- Cross-agent communication
- Priority scoring algorithms
- Human notification triggers

### Success Metrics
- Task completion rate
- Agent utilization efficiency
- Time to human review
- Blocker resolution time

---

## 2. Repo Scout Agent

**Primary Function**: Repository monitoring and issue discovery

### Responsibilities
- Scan repos for CI/CD failures
- Identify outdated dependencies
- Detect security vulnerabilities
- Find code quality issues
- Monitor test coverage gaps
- Track tech debt markers (TODO, FIXME, etc.)
- Generate issue tickets for findings

### Capabilities
- GitHub API access (read-only)
- Dependency analysis tools
- Static code analysis
- Test coverage reporting
- Security scanning (npm audit, etc.)

### Success Metrics
- Issues discovered vs. missed
- False positive rate
- Time to detection
- Coverage improvement trends

### Patrol Schedule
- Continuous: CI/CD status
- Daily: Dependency updates
- Weekly: Full code quality scan
- Monthly: Tech debt assessment

---

## 3. Code Agents (Specialized)

Multiple specialist agents for different code domains:

### 3a. Backend Agent

**Focus**: API, database, server-side logic

#### Responsibilities
- Implement backend features
- Fix API bugs
- Optimize database queries
- Add new endpoints
- Refactor server code
- Update dependencies

#### Tech Stack
- Node.js/Express
- SQLite/SQL
- REST APIs
- Authentication/Authorization

### 3b. Frontend Agent

**Focus**: UI, UX, client-side functionality

#### Responsibilities
- Implement UI components
- Fix rendering issues
- Improve accessibility
- Optimize client performance
- Update UI frameworks

#### Tech Stack
- HTML/CSS/JavaScript
- ExcelJS (report generation)
- PWA features
- Responsive design

### 3c. Infrastructure Agent

**Focus**: Deployment, DevOps, configuration

#### Responsibilities
- Update deployment scripts
- Manage secrets and env vars
- Configure CI/CD pipelines
- Set up monitoring
- Handle cloud resources

#### Tech Stack
- Google App Engine
- GitHub Actions
- Cloud Storage
- Secret Manager
- Docker

### 3d. Data/Reporting Agent

**Focus**: Reports, exports, data transformations

#### Responsibilities
- Generate accurate reports
- Fix export formatting
- Implement new report types
- Optimize data queries
- Validate calculations

#### Tech Stack
- ExcelJS
- SQL queries
- Data validation
- Time/payroll calculations

### Shared Capabilities
- Git operations (branch, commit, PR)
- Code review standards
- Testing requirements
- Documentation updates

### Success Metrics (All Code Agents)
- PR acceptance rate
- Bug introduction rate
- Code review score
- Test coverage added
- Documentation completeness

---

## 4. Test Agent

**Primary Function**: Automated testing and validation

### Responsibilities
- Execute test suites (unit, integration, E2E)
- Create new test cases
- Identify flaky tests
- Run regression tests on PRs
- Generate test coverage reports
- Maintain test infrastructure
- Update test data/fixtures

### Capabilities
- Playwright for E2E testing
- Jest/Mocha for unit tests
- Test environment management
- Screenshot/artifact capture
- Performance benchmarking

### Test Levels
1. **Unit**: Individual functions
2. **Integration**: Component interactions
3. **E2E**: Full user workflows
4. **Regression**: Previously fixed bugs
5. **Performance**: Load and speed tests

### Success Metrics
- Test pass rate
- Coverage percentage
- Test execution time
- Flake rate
- Bug escape rate

---

## 5. QA Agent

**Primary Function**: Quality assurance and validation

### Responsibilities
- Validate feature completeness
- Verify bug fixes
- Run cross-browser/device tests
- Check accessibility compliance
- Validate business logic
- Perform exploratory testing
- Review documentation accuracy

### Capabilities
- Manual test execution
- Checklist validation
- User flow simulation
- Edge case discovery
- Compliance checking

### Quality Gates
- ✅ All automated tests pass
- ✅ No critical bugs
- ✅ Feature requirements met
- ✅ Accessibility WCAG AA
- ✅ Documentation updated
- ✅ No security issues

### Success Metrics
- Defects found before prod
- False pass rate
- Regression detection rate
- User acceptance score

---

## 6. Deploy Agent

**Primary Function**: Deployment management

### Responsibilities
- Execute deployment pipelines
- Monitor deployment health
- Perform rollbacks if needed
- Manage blue/green deployments
- Update deployment documentation
- Verify post-deployment smoke tests
- Coordinate with monitoring

### Capabilities
- CI/CD pipeline execution
- Cloud platform APIs
- Health check validation
- Rollback procedures
- Deployment notifications

### Deployment Flow
1. **Pre-flight**: Run smoke tests
2. **Deploy**: Execute deployment
3. **Verify**: Health checks
4. **Monitor**: Watch metrics for 15 min
5. **Notify**: Alert human if issues
6. **Rollback**: Automatic if critical failure

### Success Metrics
- Deployment success rate
- Mean time to deploy
- Rollback frequency
- Downtime incidents
- Recovery time

---

## 7. Expert Agent (Domain Intelligence)

**Primary Function**: Construction management domain expertise and strategic guidance

### Responsibilities
- Continuously learn construction management best practices
- Study design, architecture, construction systems
- Master finance, estimating, and accounting principles
- Analyze codebase against industry standards
- Provide strategic recommendations to other agents
- Identify gaps in feature coverage
- Suggest architectural improvements
- Guide prioritization based on industry needs

### Capabilities
- Access to construction management knowledge bases
- Code pattern analysis and comparison
- Industry standard compliance checking
- Best practice recommendation engine
- Cross-domain insight synthesis

### Knowledge Domains
- **Design & Architecture**: CAD integration, drawing management, RFI workflows
- **Construction**: Schedule management, resource allocation, safety compliance
- **Finance**: Job costing, cash flow, billing cycles, lien management
- **Estimating**: Quantity takeoffs, labor rates, material pricing, bid management
- **Accounting**: GL integration, payroll, AP/AR, job cost accounting
- **Project Management**: Change orders, submittals, daily logs, punch lists
- **Systems**: ERP integration, mobile workforce, document management

### Research Loop
1. **Weekly**: Scan industry publications and construction tech trends
2. **Bi-weekly**: Analyze codebase for gaps vs. industry standards
3. **Monthly**: Generate strategic roadmap recommendations
4. **Quarterly**: Deep dive into emerging construction tech

### Output to Other Agents
- **To Orchestrator**: Priority suggestions based on industry impact
- **To Code Agents**: "Industry best practice: feature X should work like Y"
- **To QA Agent**: "Compliance check: verify against construction accounting standards"
- **To Repo Scout**: "Watch for: integration opportunities with [industry tool]"

### Success Metrics
- Recommendation acceptance rate by other agents
- Feature coverage vs. industry standard checklists
- Time to identify strategic opportunities
- Codebase maturity score vs. industry benchmarks

---

## 8. Monitor Agent

**Primary Function**: Production monitoring and alerting

### Responsibilities
- Track application health metrics
- Monitor error rates and logs
- Detect anomalies
- Alert on threshold breaches
- Generate health reports
- Track SLA compliance
- Identify performance degradation

### Capabilities
- Log aggregation and analysis
- Metrics collection
- Alert generation
- Trend analysis
- Incident correlation

### Monitoring Domains
- **Availability**: Uptime, response time
- **Performance**: Latency, throughput
- **Errors**: Error rates, crash reports
- **Resources**: CPU, memory, disk
- **Business**: User actions, conversions

### Alert Levels
- 🔴 **Critical**: Production down, data loss
- 🟠 **High**: Degraded performance, errors
- 🟡 **Medium**: Warnings, trends
- 🔵 **Info**: Routine events

### Success Metrics
- Mean time to detect (MTTD)
- Alert accuracy
- False positive rate
- Incident resolution time

---

## Agent Collaboration Matrix

| Initiating Agent | Collaborates With | Purpose |
|-----------------|-------------------|---------|
| Orchestrator | All | Task assignment, status |
| Repo Scout | Orchestrator | Issue creation |
| Code Agents | Test Agent | Test creation, validation |
| Code Agents | QA Agent | Feature validation |
| Test Agent | QA Agent | Test result interpretation |
| QA Agent | Deploy Agent | Release approval |
| Deploy Agent | Monitor Agent | Post-deploy validation |
| Monitor Agent | Orchestrator | Incident reporting |

---

## Communication Protocols

### Status Updates
- **Frequency**: Every 4 hours during active work
- **Format**: Markdown summary in PR comments
- **Content**: Progress, blockers, next steps

### Handoffs
- **Trigger**: Task completion or blocker
- **Process**: Update task board, notify next agent
- **Documentation**: Comment on PR/issue

### Human Escalation
- **Criteria**:
  - Critical production issue
  - Blocked for >24 hours
  - Conflicting requirements
  - Security concerns
  - Major architectural decisions

### Approval Gates
- **Code Changes**: Test Agent → QA Agent → Human
- **Deployments**: QA Agent → Deploy Agent → Human
- **Security**: Immediate human notification

---

## Agent Lifecycle

### Initialization
1. Load project context from persist.txt
2. Review assigned role documentation
3. Check for pending tasks
4. Verify access/credentials
5. Report ready status

### Active Work
1. Pull latest code
2. Create feature branch
3. Implement changes
4. Run tests locally
5. Create PR with detailed description
6. Await review/approval

### Standby
1. Monitor for new assignments
2. Review other agents' work
3. Update documentation
4. Refine test suites
5. Analyze metrics

### Termination
1. Complete current task or hand off
2. Document final status
3. Archive artifacts
4. Update knowledge base

---

**Last Updated**: 2026-02-04  
**Version**: 1.0
