#!/usr/bin/env bash
set -euo pipefail

# Ubuntu/Debian requirements for this repo (SQLite + better-sqlite3 build)
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  curl ca-certificates git \
  build-essential python3

# Node 20+ (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node -v
npm -v
