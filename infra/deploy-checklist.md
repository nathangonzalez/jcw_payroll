# Deploy Checklist
# Updated: 2026-03-03

## Scope

Use this checklist for every module deploy (new module or update).

## Pre-Deploy

1. Branch state
- [ ] Work is on the declared feature branch.
- [ ] PR exists with summary, tests, and rollback note.

2. Contracts
- [ ] `node scripts/control_plane_audit.mjs` passes.
- [ ] Module exists in `infra/module-registry.json`.
- [ ] Domain, port, and health path are defined.

3. Quality
- [ ] Test suite passes in target repo.
- [ ] Smoke check passes locally or in staging.
- [ ] README updated with run/migrate notes.

4. Data
- [ ] Migration plan documented.
- [ ] Backup taken before schema/data changes.
- [ ] Restore procedure tested for the module.

5. Approval
- [ ] Explicit approval recorded before production deploy.

## Deploy

1. Pull branch to deployment host.
2. Install dependencies with lockfile.
3. Run migrations (if any).
4. Restart service.
5. Reload Caddy if route changed.
6. Verify `caddy` service is active after restart.

## Post-Deploy

1. Health and routing
- [ ] Health endpoint returns success.
- [ ] Domain responds over HTTPS.
- [ ] `systemctl is-active caddy` is `active`.

2. Functional smoke
- [ ] Core module flow verified manually.
- [ ] Logs show no startup/runtime errors.

3. Observability
- [ ] Alerting active.
- [ ] Backup job verified for modules with state.

## Exit Criteria

Deploy is complete only if all post-deploy checks pass. Otherwise trigger rollback from `infra/rollback-playbook.md`.
