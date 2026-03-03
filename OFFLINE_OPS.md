# OFFLINE_OPS.md

Purpose: prove work is happening while your PC is off.

## What "proof" means

Every 15 minutes, the VM posts objective evidence to Slack:

- latest commit activity in key repos
- task queue movement (`approved` -> `in_progress` -> `completed`)
- public app health checks
- optional CFO pack freshness

Artifacts are also written locally:

- `data/offline-proof/latest.json`
- `data/offline-proof/ledger.jsonl`

## 1) One-time setup on VM

From repo root:

```bash
cd /path/to/jcw_payroll
python3 scripts/offline_work_proof.py
```

If output looks correct, create cron:

```bash
crontab -e
```

Add:

```cron
*/15 * * * * cd /path/to/jcw_payroll && OFFLINE_POST_TO_SLACK=1 python3 scripts/offline_work_proof.py >> /tmp/offline-proof.log 2>&1
```

## 2) Optional CFO freshness check

Set env var to your CFO output file (CSV/XLSX/pack):

```bash
export OFFLINE_CFO_PACK_PATH="/path/to/exports/cfo-weekly-pack.csv"
```

Then cron line:

```cron
*/15 * * * * cd /path/to/jcw_payroll && OFFLINE_POST_TO_SLACK=1 OFFLINE_CFO_PACK_PATH="/path/to/exports/cfo-weekly-pack.csv" python3 scripts/offline_work_proof.py >> /tmp/offline-proof.log 2>&1
```

## 3) Slack interpretation

- `GREEN`: recent commits or active work queue, and apps are healthy
- `AMBER`: no recent code activity and no active queue movement
- `RED`: health check failed or proof pipeline broken

## 4) Morning verification (2 commands)

```bash
cd /path/to/jcw_payroll
tail -n 20 /tmp/offline-proof.log
python3 scripts/offline_work_proof.py
```

If no Slack proof in last 30 minutes, assume the VM worker is down and restart the agent services.
