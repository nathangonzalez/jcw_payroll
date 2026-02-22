#!/usr/bin/env python
"""
Slack bridge for Cline — post messages to Slack and poll approved tasks.

Usage:
  # Post a message to #jcw_bot
  python scripts/slack_bridge.py post "Hello from Cline!"

  # Post to a specific channel
  python scripts/slack_bridge.py post --channel C0AFSUEJ2KY "Build complete."

  # List pending approved tasks
  python scripts/slack_bridge.py tasks

  # Claim the next approved task (marks it "in_progress")
  python scripts/slack_bridge.py claim

  # Complete a task by ID and post result to Slack
  python scripts/slack_bridge.py complete T-20260222-153600 "Payroll export finished. 12 records."

  # Request approval from Slack (posts card, user clicks Approve/Reject)
  python scripts/slack_bridge.py request-approval "Deploy v2.4 to production"
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
AGENT_OPS_ROOT = Path(r"C:\Users\natha\dev\repos\agent-ops")
SECRETS_PATH = AGENT_OPS_ROOT / "Slack" / "sc_manager.txt"

# Try to load bot token from environment, then from secrets file
BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "").strip()
if not BOT_TOKEN and SECRETS_PATH.exists():
    # Parse PowerShell $env:VAR = "value" lines
    for line in SECRETS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("$env:SLACK_BOT_TOKEN"):
            # $env:SLACK_BOT_TOKEN = "xoxb-..."
            parts = line.split("=", 1)
            if len(parts) == 2:
                BOT_TOKEN = parts[1].strip().strip('"').strip("'")
                break

DEFAULT_CHANNEL = os.environ.get("CLINE_SLACK_CHANNEL", "C0AFSUEJ2KY")  # #jcw_bot
APPROVED_TASKS_PATH = Path(
    os.environ.get(
        "CLAWDBOT_APPROVED_TASKS",
        str(AGENT_OPS_ROOT / "tasks" / "approved_tasks.json"),
    )
)


# ---------------------------------------------------------------------------
# Slack API helpers
# ---------------------------------------------------------------------------
def slack_post(method: str, payload: dict) -> dict:
    """Call a Slack Web API method via urllib (no dependencies needed)."""
    if not BOT_TOKEN:
        print("ERROR: No SLACK_BOT_TOKEN found.", file=sys.stderr)
        sys.exit(1)
    url = f"https://slack.com/api/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {BOT_TOKEN}",
        },
    )
    try:
        with urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if not body.get("ok"):
                print(f"Slack API error: {body.get('error', 'unknown')}", file=sys.stderr)
            return body
    except URLError as exc:
        print(f"Slack request failed: {exc}", file=sys.stderr)
        sys.exit(1)


def post_message(channel: str, text: str) -> dict:
    return slack_post("chat.postMessage", {"channel": channel, "text": text})


def post_approval_request(channel: str, task: str) -> dict:
    """Post an approval card to Slack (same format the bot uses)."""
    blocks = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Approval requested*\nTask: {task}"},
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": "Requested by Cline"}],
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Approve"},
                    "style": "primary",
                    "action_id": "claw_approve",
                    "value": "approve",
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Reject"},
                    "style": "danger",
                    "action_id": "claw_reject",
                    "value": "reject",
                },
            ],
        },
    ]
    return slack_post(
        "chat.postMessage",
        {
            "channel": channel,
            "text": f"Approval requested: {task}",
            "blocks": blocks,
        },
    )


# ---------------------------------------------------------------------------
# Task queue helpers
# ---------------------------------------------------------------------------
def _load_tasks() -> list:
    if not APPROVED_TASKS_PATH.exists():
        return []
    try:
        return json.loads(APPROVED_TASKS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_tasks(items: list) -> None:
    APPROVED_TASKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    APPROVED_TASKS_PATH.write_text(json.dumps(items, indent=2), encoding="utf-8")


def list_tasks(status_filter: str = "approved") -> list:
    """Return tasks matching the given status."""
    return [t for t in _load_tasks() if t.get("status") == status_filter]


def claim_next() -> dict | None:
    """Claim the oldest approved task — set status to in_progress."""
    items = _load_tasks()
    for item in items:
        if item.get("status") == "approved":
            item["status"] = "in_progress"
            item["claimed_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            _save_tasks(items)
            return item
    return None


def complete_task(task_id: str, result: str) -> dict | None:
    """Mark a task complete and store the result."""
    items = _load_tasks()
    for item in items:
        if item.get("id") == task_id:
            item["status"] = "completed"
            item["result"] = result
            item["completed_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            _save_tasks(items)
            return item
    return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1].lower()

    if cmd == "post":
        # parse optional --channel
        channel = DEFAULT_CHANNEL
        args = sys.argv[2:]
        if args and args[0] == "--channel" and len(args) >= 2:
            channel = args[1]
            args = args[2:]
        text = " ".join(args) if args else "Hello from Cline!"
        resp = post_message(channel, text)
        if resp.get("ok"):
            print(f"Posted to {channel}: {text}")
        else:
            print(f"Failed: {resp.get('error')}", file=sys.stderr)
            sys.exit(1)

    elif cmd == "tasks":
        status = sys.argv[2] if len(sys.argv) > 2 else "approved"
        tasks = list_tasks(status)
        if not tasks:
            print(f"No tasks with status={status}")
        else:
            for t in tasks:
                print(f"  {t['id']}  {t['status']:12s}  {t.get('task', '')}")

    elif cmd == "claim":
        task = claim_next()
        if task:
            print(f"Claimed: {task['id']} — {task.get('task', '')}")
            # Output as JSON for programmatic use
            print(json.dumps(task, indent=2))
        else:
            print("No approved tasks to claim.")

    elif cmd == "complete":
        if len(sys.argv) < 4:
            print("Usage: slack_bridge.py complete <task-id> <result text>", file=sys.stderr)
            sys.exit(1)
        task_id = sys.argv[2]
        result_text = " ".join(sys.argv[3:])
        task = complete_task(task_id, result_text)
        if task:
            # Post result back to Slack
            channel = task.get("channel", DEFAULT_CHANNEL)
            msg = f"Task {task_id} completed.\nResult: {result_text}"
            post_message(channel, msg)
            print(f"Completed {task_id} and posted to Slack.")
        else:
            print(f"Task {task_id} not found.", file=sys.stderr)
            sys.exit(1)

    elif cmd == "request-approval":
        channel = DEFAULT_CHANNEL
        args = sys.argv[2:]
        if args and args[0] == "--channel" and len(args) >= 2:
            channel = args[1]
            args = args[2:]
        task_text = " ".join(args) if args else "Unspecified task"
        resp = post_approval_request(channel, task_text)
        if resp.get("ok"):
            print(f"Approval card posted to {channel}: {task_text}")
        else:
            print(f"Failed: {resp.get('error')}", file=sys.stderr)
            sys.exit(1)

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()