#!/bin/bash
echo '=== VS Code Tunnel Fresh Setup ==='
echo ''
echo 'Step 1: Authenticating with GitHub...'
echo '  When you see a device code, enter it at https://github.com/login/device IMMEDIATELY'
echo ''

/usr/local/bin/code tunnel --name jcw-dev-server --accept-server-license-terms

echo ''
echo 'Step 2: Tunnel exited. Creating systemd service...'

sudo tee /etc/systemd/system/code-tunnel.service > /dev/null << 'SVC'
[Unit]
Description=VS Code Tunnel (jcw-dev-server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nathan
ExecStart=/usr/local/bin/code tunnel --name jcw-dev-server --accept-server-license-terms
Restart=always
RestartSec=10
Environment=HOME=/home/nathan

[Install]
WantedBy=multi-user.target
SVC

sudo systemctl daemon-reload
sudo systemctl enable code-tunnel.service
sudo systemctl start code-tunnel.service
echo ''
echo '=== DONE! Service running ==='
sudo systemctl status code-tunnel.service --no-pager