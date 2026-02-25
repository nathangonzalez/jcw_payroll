# Labor Timekeeper - Migration to Persistent VM

**Status:** In Progress — Core Complete, Networking Pending  
**Updated:** 2026-02-25

## Overview
The `labor-timekeeper` app was running on Google App Engine Standard with ephemeral `/tmp` storage, causing data loss on every restart. This migration moves it to the `clawbot-ops` VM (us-central1-a) with persistent disk storage.

## What's Done ✅

### 1. App Running on VM
- **Node.js v22** running `server.js` directly (no Docker needed)
- **Systemd service:** `labor-timekeeper.service` — auto-restarts, runs as `nathan`
- **Database:** `data/prod/app.db` on persistent disk — 390 entries, 95 customers, 8 employees
- **Health check:** `curl localhost:8080/api/health` → ✅ OK
- **Secrets:** Loaded from Google Cloud Secret Manager (SMTP_USER, SMTP_PASS, OPENAI_API_KEY)

### 2. Persistent Storage Fix
- Added `verifyDbEntries()` check before cloud restore in `server.js`
- If local DB already has data, **skips GCS download** → no more SQLITE_BUSY crashes
- On App Engine (ephemeral `/tmp`), local DB is always empty → restore still runs
- Env var override: `SKIP_CLOUD_RESTORE=1` for explicit control

### 3. Configuration Files
- **`.env.prod`** — Production environment vars (NODE_ENV, PORT, DATABASE_PATH, etc.)
- **`labor-timekeeper.service`** — Systemd unit file (installed at `/etc/systemd/system/`)
- **`docker-compose.prod.yml`** — Available but not used (direct Node is simpler)

## What's Remaining ⏳

### 4. Networking (Nate Approval Required)
The VM app runs on `localhost:8080`. Users access it via the App Engine `*.appspot.com` URL. Options to expose:

**Option A: GCP Firewall Rule (Simplest)**
```bash
# Run this to open port 8080 on the VM:
gcloud compute firewall-rules create allow-timekeeper \
  --project=jcw-2-android-estimator \
  --allow=tcp:8080 \
  --target-tags=http-server \
  --source-ranges=0.0.0.0/0

# Then tag the VM:
gcloud compute instances add-tags clawbot-ops \
  --project=jcw-2-android-estimator \
  --zone=us-central1-a \
  --tags=http-server
```
Then update `proxy_server.js` to point to `http://34.31.213.200:8080` and deploy proxy to App Engine.

**Option B: ngrok Tunnel (Already installed, no firewall changes)**
```bash
# On VM:
ngrok http 8080
# Get the URL, update proxy_server.js, deploy to App Engine
# Downside: URL changes on ngrok restart (unless paid plan)
```

**Option C: Cloudflare Tunnel (Most robust, requires Cloudflare setup)**
```bash
# Install cloudflared, create named tunnel → stable URL
```

### 5. GCS Write Permissions
The VM's service account (`clawbot-sa@...`) needs storage write access for backups:
```bash
gcloud projects add-iam-policy-binding jcw-2-android-estimator \
  --member=serviceAccount:clawbot-sa@jcw-2-android-estimator.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

### 6. App Engine Proxy Update
Once networking is resolved:
1. Update `TARGET_URL` in `proxy_server.js`
2. Deploy: `gcloud app deploy app_proxy.yaml --project=jcw-2-android-estimator`

### 7. Automated Backups
The app already has built-in GCS backup (every 5 min + daily snapshots). Once GCS write permissions are granted (step 5), these will work automatically. Alternatively, add a local cron backup.

## Architecture

```
Users → App Engine (*.appspot.com, SSL) → Proxy → VM:8080 (labor-timekeeper)
                                                      ↓
                                              data/prod/app.db (persistent disk)
                                                      ↓
                                              GCS backup (every 5 min)
```

## Service Management
```bash
# Check status
sudo systemctl status labor-timekeeper

# View logs
sudo journalctl -u labor-timekeeper -f

# Restart
sudo systemctl restart labor-timekeeper

# Stop
sudo systemctl stop labor-timekeeper
```

## Rollback Plan
If anything goes wrong:
1. Stop the VM service: `sudo systemctl stop labor-timekeeper`
2. Deploy the original `app.yaml` to App Engine (it will restore from GCS on startup)
3. The VM database is untouched and can be reactivated later
