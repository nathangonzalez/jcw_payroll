#!/usr/bin/env bash
# =============================================================================
# VS Code Server + Cline — Always-On VM Setup Script
# Target: GCP e2-medium (2 vCPU, 4GB RAM), Ubuntu 22.04 LTS
# Purpose: 24/7 development server with VS Code tunnels + Cline extension
# =============================================================================
set -euo pipefail

echo "=== JCW Dev Server Setup ==="
echo "Started at $(date)"

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  git curl wget ca-certificates gnupg lsb-release unzip jq \
  python3-full python3-pip python3-venv \
  build-essential sqlite3 tmux htop

# ---------------------------------------------------------------------------
# 2. Node.js 22.x
# ---------------------------------------------------------------------------
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "Node: $(node --version)"

# ---------------------------------------------------------------------------
# 3. VS Code CLI (for tunnel mode)
# ---------------------------------------------------------------------------
if ! command -v code &>/dev/null; then
  echo "Installing VS Code CLI..."
  curl -fsSL "https://code.visualstudio.com/sha/download?build=stable&os=cli-linux-x64" \
    -o /tmp/vscode_cli.tar.gz
  tar -xzf /tmp/vscode_cli.tar.gz -C /usr/local/bin/
  rm /tmp/vscode_cli.tar.gz
fi
echo "VS Code CLI: $(code --version 2>/dev/null || echo 'installed')"

# ---------------------------------------------------------------------------
# 4. code-server (web-based fallback)
# ---------------------------------------------------------------------------
if ! command -v code-server &>/dev/null; then
  echo "Installing code-server..."
  curl -fsSL https://code-server.dev/install.sh | sh
fi

# ---------------------------------------------------------------------------
# 5. Create dev user (if not exists)
# ---------------------------------------------------------------------------
DEV_USER="nathan"
if ! id "$DEV_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEV_USER"
  usermod -aG sudo "$DEV_USER"
  echo "$DEV_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$DEV_USER
fi
DEV_HOME="/home/$DEV_USER"

# ---------------------------------------------------------------------------
# 6. Clone repos
# ---------------------------------------------------------------------------
su - "$DEV_USER" -c "
  mkdir -p ~/dev/repos
  cd ~/dev/repos

  if [ ! -d jcw_payroll/.git ]; then
    git clone https://github.com/nathangonzalez/jcw_payroll.git
  else
    cd jcw_payroll && git pull --ff-only && cd ..
  fi

  if [ ! -d agent-ops/.git ]; then
    git clone https://github.com/nathangonzalez/jcw-agent-ops.git agent-ops
  else
    cd agent-ops && git pull --ff-only && cd ..
  fi
"

# ---------------------------------------------------------------------------
# 7. Install project deps
# ---------------------------------------------------------------------------
su - "$DEV_USER" -c "
  cd ~/dev/repos/jcw_payroll/labor-timekeeper && npm ci --production 2>/dev/null || npm install
  cd ~/dev/repos/agent-ops && pip3 install --user slack-bolt slack-sdk 2>/dev/null || true
"

# ---------------------------------------------------------------------------
# 8. Fetch secrets from Secret Manager
# ---------------------------------------------------------------------------
PROJECT_ID="$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)"

fetch_secret() {
  gcloud secrets versions access latest --secret="$1" --project="$PROJECT_ID" 2>/dev/null || echo ""
}

SLACK_BOT_TOKEN="$(fetch_secret slack_bot_token)"
SLACK_APP_TOKEN="$(fetch_secret slack_app_token)"
SLACK_SIGNING_SECRET="$(fetch_secret slack_signing_secret)"
ANTHROPIC_API_KEY="$(fetch_secret anthropic_api_key)"

# Write env file for services
cat > /etc/jcw-dev.env <<EOF
SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
EOF
chmod 600 /etc/jcw-dev.env

# Also write to user's bashrc for interactive sessions
su - "$DEV_USER" -c "
cat >> ~/.bashrc <<'ENVEOF'

# JCW Dev Environment
export SLACK_BOT_TOKEN=\"${SLACK_BOT_TOKEN}\"
export SLACK_APP_TOKEN=\"${SLACK_APP_TOKEN}\"
export SLACK_SIGNING_SECRET=\"${SLACK_SIGNING_SECRET}\"
export ANTHROPIC_API_KEY=\"${ANTHROPIC_API_KEY}\"
export CLINE_SLACK_CHANNEL=\"C0AFSUEJ2KY\"
ENVEOF
"

# ---------------------------------------------------------------------------
# 9. code-server config
# ---------------------------------------------------------------------------
su - "$DEV_USER" -c "
  mkdir -p ~/.config/code-server
  cat > ~/.config/code-server/config.yaml <<'CSEOF'
bind-addr: 0.0.0.0:8080
auth: password
password: jcw_dev_2026
cert: false
CSEOF
"

# ---------------------------------------------------------------------------
# 10. Systemd services
# ---------------------------------------------------------------------------

# code-server service
cat > /etc/systemd/system/code-server.service <<EOF
[Unit]
Description=code-server (Web VS Code)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DEV_USER
WorkingDirectory=$DEV_HOME/dev/repos/jcw_payroll
EnvironmentFile=/etc/jcw-dev.env
ExecStart=/usr/bin/code-server --bind-addr 0.0.0.0:8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# VS Code tunnel service (for vscode.dev remote access)
cat > /etc/systemd/system/code-tunnel.service <<EOF
[Unit]
Description=VS Code Tunnel (Remote Access)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DEV_USER
WorkingDirectory=$DEV_HOME/dev/repos/jcw_payroll
EnvironmentFile=/etc/jcw-dev.env
ExecStart=/usr/local/bin/code tunnel --accept-server-license-terms --name jcw-dev-server
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Clawbot Slack relay (keep existing bot running)
cat > /etc/systemd/system/clawbot.service <<EOF
[Unit]
Description=Clawbot Slack Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$DEV_USER
EnvironmentFile=/etc/jcw-dev.env
WorkingDirectory=$DEV_HOME/dev/repos/agent-ops
ExecStart=/usr/bin/python3 $DEV_HOME/dev/repos/agent-ops/scripts/slack_bot.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now code-server.service
systemctl enable --now clawbot.service
# Don't auto-start tunnel — needs interactive GitHub auth first
systemctl enable code-tunnel.service

# ---------------------------------------------------------------------------
# 11. Firewall: open port 8080 for code-server
# ---------------------------------------------------------------------------
echo "NOTE: You need to create a GCP firewall rule for port 8080:"
echo "  gcloud compute firewall-rules create allow-code-server \\"
echo "    --allow=tcp:8080 --target-tags=code-server --source-ranges=0.0.0.0/0"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "=== Setup Complete ==="
echo "code-server: http://$(curl -s ifconfig.me):8080 (password: jcw_dev_2026)"
echo "VS Code tunnel: run 'sudo systemctl start code-tunnel' after GitHub auth"
echo "Clawbot: running as systemd service"
echo "Repos: $DEV_HOME/dev/repos/{jcw_payroll,agent-ops}"
echo ""
echo "Next steps:"
echo "  1. SSH in and run: sudo -u $DEV_USER code tunnel --accept-server-license-terms --name jcw-dev-server"
echo "  2. Complete GitHub auth in the terminal"
echo "  3. Then: sudo systemctl start code-tunnel"
echo "  4. Access via vscode.dev or VS Code Remote Tunnels"
echo "  5. Install Cline extension in the remote VS Code"
echo ""
echo "Finished at $(date)"