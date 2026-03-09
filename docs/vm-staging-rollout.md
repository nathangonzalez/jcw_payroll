# VM Staging Rollout (1:1 with Prod)

This repo now supports a VM-native staging lane for Labor Timekeeper.

## What changed

- Staging deploy target is a separate systemd service:
  - `labor-timekeeper-staging`
  - port `18080`
  - env file `.env.staging`
  - DB path `data/staging/app.db`
- UAT runs against staging through an SSH tunnel in GitHub Actions.
- Promote deploys the exact approved commit SHA to prod service (`labor-timekeeper`).
- Promote fails if prod is not loopback-bound on `:8080`.

## Required GitHub Secrets

- `VM_HOST`
- `VM_USER`
- `VM_SSH_KEY`

Optional:

- `VM_SSH_PORT` (default `22`)
- `VM_SERVICE_USER` (default `nathan`)
- `VM_DEPLOY_PATH` (default `/home/<VM_SERVICE_USER>/dev/repos/jcw_payroll`)
- `VM_STAGING_DEPLOY_PATH` (default `/home/<VM_SERVICE_USER>/dev/repos/jcw_payroll-staging`)
- `VM_SERVICE_NAME` (default `labor-timekeeper`)
- `VM_STAGING_SERVICE_NAME` (default `labor-timekeeper-staging`)
- `VM_STAGING_PORT` (default `18080`)
- `VM_LOCAL_HEALTH_URL` (default `http://127.0.0.1:8080/api/health`)
- `STAGING_ADMIN_SECRET` (default `demo`)

## Required GitHub Variable

- `PAYROLL_PROD_HEALTH_URL` (optional, default `https://payroll.jcwelton.com/api/health`)

## Quick validation

1. Run `CI/CD` workflow with `workflow_dispatch`.
2. Confirm jobs pass:
   - `build-and-test`
   - `deploy-staging`
   - `uat-demo`
   - `uat-approval` (manual gate)
   - `promote`
3. Verify prod health endpoint returns `ok: true`.
