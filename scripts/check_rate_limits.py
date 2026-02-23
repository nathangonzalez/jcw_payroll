#!/usr/bin/env python3
"""
Rate Limit Monitor for OpenAI API.

Checks if OpenAI rate limits have reset and posts to Slack.
Can be run as a one-shot check or in polling mode.

Usage:
  python check_rate_limits.py                    # One-shot check
  python check_rate_limits.py --poll             # Poll every 60s until limit resets
  python check_rate_limits.py --poll --interval 30  # Poll every 30s

Environment variables:
  OPENAI_API_KEY    - OpenAI API key (or reads from GCP Secret Manager)
  SLACK_BOT_TOKEN   - Slack bot token for notifications
  SLACK_CHANNEL     - Slack channel ID (default: C0AFSUEJ2KY = #jcw_bot)
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


# --- Config ---
SLACK_CHANNEL = os.environ.get("SLACK_CHANNEL", "C0AFSUEJ2KY")  # #jcw_bot
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_MODELS_URL = "https://api.openai.com/v1/models"


def get_openai_key():
    """Get OpenAI API key from env, file, or GCP Secret Manager."""
    # 1. Environment variable
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key

    # 2. Try GCP Secret Manager via gcloud CLI
    try:
        import subprocess
        result = subprocess.run(
            ["gcloud", "secrets", "versions", "access", "latest",
             "--secret=openai_api_key", "--format=value(payload.data)"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass

    # 3. Try agent-ops env file
    env_paths = [
        Path("/etc/jcw-dev.env"),
        Path("/etc/clawbot.env"),
        Path.home() / ".openai_key",
    ]
    for p in env_paths:
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith("OPENAI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")

    return None


def get_slack_token():
    """Get Slack bot token from env or file."""
    token = os.environ.get("SLACK_BOT_TOKEN")
    if token:
        return token

    # Try the sc_manager.txt file
    paths = [
        Path(__file__).parent.parent / ".." / "agent-ops" / "Slack" / "sc_manager.txt",
        Path.home() / "dev" / "repos" / "agent-ops" / "Slack" / "sc_manager.txt",
    ]
    for p in paths:
        try:
            p = p.resolve()
            if p.exists():
                content = p.read_text().strip()
                # File may contain just the token or key=value pairs
                for line in content.splitlines():
                    if line.startswith("xoxb-"):
                        return line.strip()
                    if "SLACK_BOT_TOKEN" in line:
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
                # If single line, might be just the token
                if content.startswith("xoxb-"):
                    return content
        except Exception:
            continue

    return None


def check_openai_rate_limit(api_key):
    """
    Make a minimal API call to check rate limit status.
    Returns dict with rate limit info or error.
    """
    # Use list models endpoint — lightweight, no tokens consumed
    req = Request(OPENAI_MODELS_URL)
    req.add_header("Authorization", f"Bearer {api_key}")

    try:
        response = urlopen(req, timeout=15)
        headers = dict(response.headers)

        return {
            "status": "ok",
            "http_code": response.status,
            "rate_limit": {
                "limit_requests": headers.get("x-ratelimit-limit-requests"),
                "remaining_requests": headers.get("x-ratelimit-remaining-requests"),
                "reset_requests": headers.get("x-ratelimit-reset-requests"),
                "limit_tokens": headers.get("x-ratelimit-limit-tokens"),
                "remaining_tokens": headers.get("x-ratelimit-remaining-tokens"),
                "reset_tokens": headers.get("x-ratelimit-reset-tokens"),
            }
        }
    except HTTPError as e:
        headers = dict(e.headers) if e.headers else {}
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass

        result = {
            "status": "rate_limited" if e.code == 429 else "error",
            "http_code": e.code,
            "message": body[:500],
            "rate_limit": {
                "limit_requests": headers.get("x-ratelimit-limit-requests"),
                "remaining_requests": headers.get("x-ratelimit-remaining-requests"),
                "reset_requests": headers.get("x-ratelimit-reset-requests"),
                "limit_tokens": headers.get("x-ratelimit-limit-tokens"),
                "remaining_tokens": headers.get("x-ratelimit-remaining-tokens"),
                "reset_tokens": headers.get("x-ratelimit-reset-tokens"),
            },
            "retry_after": headers.get("retry-after"),
        }

        # Try to parse error body for more info
        try:
            err_json = json.loads(body)
            if "error" in err_json:
                result["error_type"] = err_json["error"].get("type", "unknown")
                result["error_message"] = err_json["error"].get("message", "")
        except Exception:
            pass

        return result
    except URLError as e:
        return {"status": "network_error", "message": str(e)}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def post_slack(token, message, channel=None):
    """Post a message to Slack."""
    if not token:
        print(f"[slack] No token — would have posted: {message}")
        return False

    channel = channel or SLACK_CHANNEL
    payload = json.dumps({
        "channel": channel,
        "text": message,
    }).encode("utf-8")

    req = Request("https://slack.com/api/chat.postMessage", data=payload)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")

    try:
        response = urlopen(req, timeout=10)
        result = json.loads(response.read().decode())
        if result.get("ok"):
            print(f"[slack] Posted to {channel}")
            return True
        else:
            print(f"[slack] Error: {result.get('error', 'unknown')}")
            return False
    except Exception as e:
        print(f"[slack] Failed: {e}")
        return False


def format_status(result):
    """Format rate limit check result for display."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    if result["status"] == "ok":
        rl = result["rate_limit"]
        remaining = rl.get("remaining_requests", "?")
        limit = rl.get("limit_requests", "?")
        remaining_tok = rl.get("remaining_tokens", "?")
        limit_tok = rl.get("limit_tokens", "?")
        return (
            f"✅ OpenAI API accessible ({now})\n"
            f"  Requests: {remaining}/{limit} remaining\n"
            f"  Tokens: {remaining_tok}/{limit_tok} remaining"
        )
    elif result["status"] == "rate_limited":
        retry = result.get("retry_after", "unknown")
        reset_req = result["rate_limit"].get("reset_requests", "unknown")
        msg = result.get("error_message", "Rate limited")
        return (
            f"🔴 Rate limited ({now})\n"
            f"  {msg}\n"
            f"  Retry-After: {retry}\n"
            f"  Reset-Requests: {reset_req}"
        )
    elif result["status"] == "error":
        code = result.get("http_code", "?")
        msg = result.get("error_message", result.get("message", "Unknown error"))
        return f"⚠️ API error {code} ({now}): {msg}"
    else:
        return f"❓ {result['status']} ({now}): {result.get('message', '')}"


def main():
    parser = argparse.ArgumentParser(description="Check OpenAI API rate limits")
    parser.add_argument("--poll", action="store_true", help="Poll until limit resets")
    parser.add_argument("--interval", type=int, default=60, help="Poll interval in seconds")
    parser.add_argument("--slack", action="store_true", help="Post result to Slack")
    parser.add_argument("--quiet", action="store_true", help="Only output on status change")
    args = parser.parse_args()

    api_key = get_openai_key()
    if not api_key:
        print("❌ No OpenAI API key found. Set OPENAI_API_KEY or add to GCP Secret Manager.")
        sys.exit(1)

    slack_token = get_slack_token() if args.slack else None

    last_status = None

    while True:
        result = check_openai_rate_limit(api_key)
        status_msg = format_status(result)

        if not args.quiet or result["status"] != last_status:
            print(status_msg)

        # If polling and limit just reset, alert and exit
        if args.poll and last_status == "rate_limited" and result["status"] == "ok":
            alert = "🟢 OpenAI rate limit has RESET — you're good to go!"
            print(f"\n{alert}")
            if args.slack or slack_token:
                post_slack(slack_token or get_slack_token(), alert)
            break

        # If not polling, just report and exit
        if not args.poll:
            if args.slack and slack_token:
                post_slack(slack_token, status_msg)
            break

        # If ok and we haven't been rate limited before, we're already good
        if args.poll and result["status"] == "ok" and last_status is None:
            alert = "✅ OpenAI API is accessible — no rate limit detected."
            print(alert)
            if args.slack or slack_token:
                post_slack(slack_token or get_slack_token(), alert)
            break

        last_status = result["status"]
        time.sleep(args.interval)


if __name__ == "__main__":
    main()