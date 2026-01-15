#!/bin/bash
# Production Deployment Script for Google Cloud App Engine
# 
# Prerequisites:
#   1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
#   2. Authenticate: gcloud auth login
#   3. Set project: gcloud config set project YOUR_PROJECT_ID
#
# Usage:
#   ./deploy-gcloud.sh                    # Deploy to App Engine (promote)
#   ./deploy-gcloud.sh --seed             # Deploy and then seed database
#   ./deploy-gcloud.sh --patch            # Deploy as a patch (no-promote) so you can smoke-test before promoting

set -e

echo "=============================================="
echo "Labor Timekeeper - Google Cloud Deployment"
echo "=============================================="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "ERROR: gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -1 &> /dev/null; then
    echo "ERROR: Not authenticated. Run: gcloud auth login"
    exit 1
fi

# Get current project
PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT" ]; then
    echo "ERROR: No project set. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "Deploying to project: $PROJECT"
echo ""

# Run npm install to ensure dependencies are up to date
echo "[1/3] Installing dependencies..."
npm ci --production

# Deploy to App Engine
echo "[2/3] Deploying to App Engine..."
# If --patch requested, deploy with a unique version and don't promote (safer patch flow)
if [ "$1" == "--patch" ] || [ "$PATCH" == "1" ]; then
    VERSION="patch-$(date +%s)"
    echo "Patch deploy mode: version=$VERSION (no promote)"
    gcloud app deploy app.yaml --project="$PROJECT" --version="$VERSION" --no-promote --quiet
    echo "Deployed version $VERSION (not promoted). Test at the version URL shown by gcloud, then promote with:" 
    echo "  gcloud app services set-traffic default --splits $VERSION=1 --project=$PROJECT --quiet"
else
    gcloud app deploy app.yaml --quiet
fi

# Get the deployed URL
URL=$(gcloud app browse --no-launch-browser 2>/dev/null | tail -1)
echo ""
echo "[3/3] Deployment complete!"
echo ""
echo "=============================================="
echo "App URL: $URL"
echo "=============================================="

# Optional: Seed database after deploy
if [ "$1" == "--seed" ]; then
    echo ""
    echo "Seeding database..."
    # Note: For App Engine, you'd need to hit an API endpoint to seed
    # or use Cloud Shell to run the seed script
    echo "NOTE: Run seed via Cloud Shell or create a /api/admin/seed endpoint"
fi

echo ""
echo "Useful commands:"
echo "  gcloud app logs tail -s labor-timekeeper    # View logs"
echo "  gcloud app browse                            # Open in browser"
echo "  gcloud app versions list                     # List versions"
