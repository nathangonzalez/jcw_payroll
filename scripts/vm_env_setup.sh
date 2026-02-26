#!/bin/bash
set -e
P=jcw-2-android-estimator

echo "Fetching secrets..."
BOT=$(gcloud secrets versions access latest --secret=slack_bot_token --project=$P)
APP=$(gcloud secrets versions access latest --secret=slack_app_token --project=$P)
SIG=$(gcloud secrets versions access latest --secret=slack_signing_secret --project=$P 2>/dev/null || echo "")
ANT=$(gcloud secrets versions access latest --secret=anthropic_api_key --project=$P)

cat > /tmp/jcw-dev.env <<EOF
SLACK_BOT_TOKEN=$BOT
SLACK_APP_TOKEN=$APP
SLACK_SIGNING_SECRET=$SIG
ANTHROPIC_API_KEY=$ANT
CLINE_SLACK_CHANNEL=C0AFSUEJ2KY
EOF

sudo mv /tmp/jcw-dev.env /etc/jcw-dev.env
sudo chmod 600 /etc/jcw-dev.env

echo "Env file created with $(wc -l < /etc/jcw-dev.env) lines"

# Also update clawbot service to use nathan user and the new env
cat > /tmp/clawbot.service <<'SVC'
[Unit]
Description=Clawbot Slack Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nathan
EnvironmentFile=/etc/jcw-dev.env
WorkingDirectory=/home/nathan/dev/repos/agent-ops
ExecStart=/usr/bin/python3 /home/nathan/dev/repos/agent-ops/scripts/slack_bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

sudo mv /tmp/clawbot.service /etc/systemd/system/clawbot.service
sudo systemctl daemon-reload
sudo systemctl restart clawbot 2>/dev/null || sudo systemctl start clawbot
sudo systemctl enable clawbot

echo "Clawbot service status:"
sudo systemctl status clawbot --no-pager 2>&1 | head -5

# Install npm deps for payroll
cd /home/nathan/dev/repos/jcw_payroll/labor-timekeeper
sudo -u nathan npm install 2>&1 | tail -3

echo "SETUP_COMPLETE"