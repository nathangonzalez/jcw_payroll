#!/usr/bin/env python3
"""
Generate a machine-checkable "proof of work" snapshot and optionally post to Slack.

Usage:
  python scripts/offline_work_proof.py

Environment variables:
  OFFLINE_REPOS             Semicolon-separated repo paths to inspect with git log -1
  OFFLINE_URLS              Semicolon-separated URLs to health check
  OFFLINE_TASK_QUEUE        Path to JSON queue (default: C:\\Users\\natha\\dev\\repos\\agent-ops\\tasks\\approved_tasks.json)
  OFFLINE_CFO_PACK_PATH     Optional path to latest CFO pack/output file
  OFFLINE_MIN_PROGRESS_MINUTES  Staleness threshold in minutes (default: 45)
  OFFLINE_OUTPUT_DIR        Folder for proof artifacts (default: data/offline-proof)
  OFFLINE_POST_TO_SLACK     "1" to post summary to Slack via scripts/slack_bridge.py
  OFFLINE_SLACK_CHANNEL     Optional Slack channel id override
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen


DEFAULT_REPOS = [
    r"C:\Users\natha\dev\repos\jcw_payroll",
    r"C:\Users\natha\dev\repos\agent-ops",
    r"C:\Users\natha\dev\repos\jcw-suite",
]

DEFAULT_URLS = [
    "https://payroll.jcwelton.com/api/health",
    "https://tasks.jcwelton.com",
    "https://apps.jcwelton.com",
]

DEFAULT_TASK_QUEUE = Path(
    r"C:\Users\natha\dev\repos\agent-ops\tasks\approved_tasks.json"
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_list_env(name: str, fallback: List[str]) -> List[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return fallback
    return [v.strip() for v in raw.split(";") if v.strip()]


def _run(cmd: List[str], cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _git_latest(repo_path: str) -> Dict[str, object]:
    repo = Path(repo_path)
    if not repo.exists():
        return {"path": repo_path, "ok": False, "error": "missing"}

    check = _run(["git", "rev-parse", "--is-inside-work-tree"], cwd=str(repo))
    if check.returncode != 0:
        return {"path": repo_path, "ok": False, "error": "not_git_repo"}

    log = _run(
        [
            "git",
            "log",
            "-1",
            "--date=iso-strict",
            "--pretty=format:%H|%ad|%an|%s",
        ],
        cwd=str(repo),
    )
    if log.returncode != 0 or not log.stdout.strip():
        return {"path": repo_path, "ok": False, "error": "git_log_failed"}

    parts = log.stdout.strip().split("|", 3)
    if len(parts) != 4:
        return {"path": repo_path, "ok": False, "error": "git_log_parse_failed"}

    sha, commit_time, author, subject = parts
    try:
        dt = datetime.fromisoformat(commit_time.replace("Z", "+00:00"))
    except ValueError:
        return {
            "path": repo_path,
            "ok": False,
            "error": "commit_time_parse_failed",
            "raw": commit_time,
        }

    age_minutes = int((_now_utc() - dt.astimezone(timezone.utc)).total_seconds() // 60)
    return {
        "path": repo_path,
        "ok": True,
        "sha": sha[:12],
        "commit_time_utc": dt.astimezone(timezone.utc).isoformat(),
        "commit_age_min": age_minutes,
        "author": author,
        "subject": subject,
    }


def _load_task_counts(path: Path) -> Dict[str, int]:
    counts: Dict[str, int] = {
        "approved": 0,
        "in_progress": 0,
        "completed": 0,
        "rejected": 0,
        "other": 0,
        "total": 0,
    }
    if not path.exists():
        return counts
    try:
        items = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return counts
    if not isinstance(items, list):
        return counts
    for item in items:
        status = str(item.get("status", "")).strip()
        key = status if status in counts else "other"
        counts[key] += 1
        counts["total"] += 1
    return counts


def _http_check(url: str, timeout: int = 8) -> Dict[str, object]:
    req = Request(url, headers={"User-Agent": "offline-work-proof/1.0"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            code = getattr(resp, "status", None) or resp.getcode()
            return {"url": url, "ok": True, "status": int(code)}
    except URLError as exc:
        return {"url": url, "ok": False, "error": str(exc.reason)}
    except Exception as exc:  # pragma: no cover
        return {"url": url, "ok": False, "error": str(exc)}


def _file_age_minutes(path: Path) -> Optional[int]:
    if not path.exists():
        return None
    try:
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return None
    return int((_now_utc() - mtime).total_seconds() // 60)


def _build_summary(snapshot: Dict[str, object]) -> str:
    status = snapshot["status"]
    ts = snapshot["generated_at_utc"]
    threshold = snapshot["stale_threshold_min"]
    lines = [
        f"[WORK PROOF] {status.upper()} @ {ts}",
        f"- threshold: {threshold} min",
    ]

    for repo in snapshot["repos"]:
        if repo["ok"]:
            lines.append(
                f"- repo {repo['path']}: {repo['commit_age_min']}m ago ({repo['sha']}) {repo['subject']}"
            )
        else:
            lines.append(f"- repo {repo['path']}: ERROR ({repo['error']})")

    q = snapshot["queue_counts"]
    lines.append(
        "- queue approved={approved} in_progress={in_progress} completed={completed} total={total}".format(
            **q
        )
    )

    for hc in snapshot["health"]:
        if hc["ok"]:
            lines.append(f"- health {hc['url']}: {hc['status']}")
        else:
            lines.append(f"- health {hc['url']}: DOWN ({hc['error']})")

    cfo = snapshot.get("cfo_pack")
    if isinstance(cfo, dict):
        age = cfo.get("age_min")
        if age is None:
            lines.append(f"- cfo pack {cfo.get('path')}: missing")
        else:
            lines.append(f"- cfo pack {cfo.get('path')}: updated {age}m ago")

    return "\n".join(lines)


def _post_to_slack(message: str, channel: Optional[str]) -> bool:
    cmd = [sys.executable, "scripts/slack_bridge.py", "post"]
    if channel:
        cmd.extend(["--channel", channel])
    cmd.append(message)
    proc = _run(cmd)
    return proc.returncode == 0


def main() -> int:
    repos = _parse_list_env("OFFLINE_REPOS", DEFAULT_REPOS)
    urls = _parse_list_env("OFFLINE_URLS", DEFAULT_URLS)
    queue_path = Path(os.environ.get("OFFLINE_TASK_QUEUE", str(DEFAULT_TASK_QUEUE)))
    threshold_min = int(os.environ.get("OFFLINE_MIN_PROGRESS_MINUTES", "45"))
    output_dir = Path(os.environ.get("OFFLINE_OUTPUT_DIR", "data/offline-proof"))
    cfo_pack_raw = os.environ.get("OFFLINE_CFO_PACK_PATH", "").strip()
    cfo_pack_path = Path(cfo_pack_raw) if cfo_pack_raw else None

    repo_rows = [_git_latest(r) for r in repos]
    health_rows = [_http_check(u) for u in urls]
    queue_counts = _load_task_counts(queue_path)

    repo_recent = any(
        bool(r.get("ok")) and int(r.get("commit_age_min", 10**9)) <= threshold_min
        for r in repo_rows
    )
    queue_moving = queue_counts.get("in_progress", 0) > 0
    all_health_ok = all(bool(h.get("ok")) for h in health_rows) if health_rows else True

    status = "green" if (repo_recent or queue_moving) and all_health_ok else "red"
    if not all_health_ok:
        status = "red"
    elif not repo_recent and not queue_moving:
        status = "amber"

    snapshot: Dict[str, object] = {
        "generated_at_utc": _now_utc().isoformat(),
        "status": status,
        "stale_threshold_min": threshold_min,
        "repos": repo_rows,
        "queue_counts": queue_counts,
        "health": health_rows,
    }

    if cfo_pack_path:
        snapshot["cfo_pack"] = {
            "path": str(cfo_pack_path),
            "age_min": _file_age_minutes(cfo_pack_path),
        }

    summary = _build_summary(snapshot)
    snapshot["summary"] = summary

    output_dir.mkdir(parents=True, exist_ok=True)
    latest = output_dir / "latest.json"
    ledger = output_dir / "ledger.jsonl"
    latest.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    with ledger.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(snapshot, separators=(",", ":")) + "\n")

    print(summary)

    if os.environ.get("OFFLINE_POST_TO_SLACK", "0") == "1":
        channel = os.environ.get("OFFLINE_SLACK_CHANNEL", "").strip() or None
        ok = _post_to_slack(summary, channel)
        if not ok:
            print("WARN: failed to post proof to Slack", file=sys.stderr)
            return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
