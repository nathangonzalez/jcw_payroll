#!/usr/bin/env bash
set -euo pipefail

echo "== Labor Timekeeper deploy =="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (20+). Install Node, then rerun."
  exit 1
fi

node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<20){console.error('Node 20+ required'); process.exit(1)}"

if [ ! -f ".env" ]; then
  echo "Creating .env from .env.example"
  cp .env.example .env
  echo "Edit .env and set OPENAI_API_KEY if you want voice."
fi

npm install
npm run seed

echo "Starting server on http://localhost:3000"
npm run start
