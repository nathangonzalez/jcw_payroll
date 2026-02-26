#!/usr/bin/env python3
"""Patch slack_bot.py to handle orphan approval cards."""
import re

PATH = r"C:\Users\natha\dev\repos\agent-ops\scripts\slack_bot.py"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

CHECK = chr(0x2705)
CROSS = chr(0x274C)
DASH = chr(0x2014)

HELPER = (
    'def _extract_task_from_blocks(blocks: list) -> str:\n'
    '    """Extract task text from approval card blocks (for orphan cards)."""\n'
    '    for block in (blocks or []):\n'
    '        if block.get("type") == "section":\n'
    '            text_obj = block.get("text", {})\n'
    '            raw = text_obj.get("text", "")\n'
    '            for line in raw.split("\\n"):\n'
    '                line = line.strip()\n'
    '                if line.lower().startswith("task:"):\n'
    '                    return line.split(":", 1)[1].strip()\n'
    '            cleaned = re.sub(r"\\*+", "", raw).strip()\n'
    '            if cleaned:\n'
    '                return cleaned\n'
    '    return "Unknown task"\n'
    '\n'
)

NEW_APPROVE = (
    '@app.action("claw_approve")\n'
    'def on_claw_approve(ack, body):\n'
    '    ack()\n'
    '    user_id = (body.get("user") or {}).get("id", "unknown")\n'
    '    message = body.get("message", {})\n'
    '    message_ts = message.get("ts")\n'
    '    channel_info = body.get("channel", {})\n'
    '    channel = channel_info.get("id") if isinstance(channel_info, dict) else str(channel_info or "")\n'
    '    log_line(f"claw_approve clicked by {user_id} ts={message_ts} channel={channel}")\n'
    '    if message_ts and message_ts in _PENDING_APPROVALS:\n'
    '        payload = _PENDING_APPROVALS.pop(message_ts)\n'
    '        task = payload.get("task") or "Unknown task"\n'
    '        channel = payload.get("channel") or channel\n'
    '        requester = payload.get("requester", "unknown")\n'
    '    else:\n'
    '        task = _extract_task_from_blocks(message.get("blocks", []))\n'
    '        requester = "external"\n'
    '        log_line(f"claw_approve: orphan card, extracted task={task}")\n'
    '    if not channel:\n'
    '        log_line("claw_approve: no channel, aborting")\n'
    '        return\n'
    '    try:\n'
    '        mark_queue_status(task, "approved")\n'
    '        raw_task = _strip_queue_prefix(task)\n'
    '        if message_ts:\n'
    '            try:\n'
    '                app.client.chat_update(\n'
    '                    channel=channel,\n'
    '                    ts=message_ts,\n'
    '                    text=f"Approved: {task}",\n'
    '                    blocks=[\n'
    '                        {"type": "section", "text": {"type": "mrkdwn", "text": f"' + CHECK + ' *Approved*\\n{task}"}},\n'
    '                        {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Approved by <@{user_id}> | Requested by <@{requester}>"}]},\n'
    '                    ],\n'
    '                )\n'
    '                log_line("claw_approve: card updated")\n'
    '            except Exception as exc:\n'
    '                log_line(f"claw_approve: card update failed: {exc}")\n'
    '        if raw_task.lower().startswith("exec:"):\n'
    '            command = raw_task.split(":", 1)[1].strip()\n'
    '            repo, cmd = extract_exec_target(f"exec {command}")\n'
    '            cwd = None\n'
    '            if repo:\n'
    '                cwd = Path(REPO_MAP.get(repo.lower(), "")).expanduser()\n'
    '            status, output = run_exec_command(cmd, cwd=cwd)\n'
    '            response = f"Exec {status}:\\n{output}"\n'
    '        elif DISABLE_OPENCLAW:\n'
    '            response = f"' + CHECK + ' Approved: {raw_task}\\n(OpenClaw disabled ' + DASH + ' approval logged.)"\n'
    '        else:\n'
    '            response = sanitize_response(run_openclaw(f"APPROVED TASK: {raw_task}"))\n'
    '        app.client.chat_postMessage(channel=channel, text=truncate(response))\n'
    '        log_line("claw_approve: response posted")\n'
    '    except Exception as exc:\n'
    '        log_line(f"claw_approve error: {exc}")\n'
    '        try:\n'
    '            app.client.chat_postMessage(channel=channel, text=f"Approval error: {exc}")\n'
    '        except Exception:\n'
    '            pass\n'
)

NEW_REJECT = (
    '@app.action("claw_reject")\n'
    'def on_claw_reject(ack, body):\n'
    '    ack()\n'
    '    user_id = (body.get("user") or {}).get("id", "unknown")\n'
    '    message = body.get("message", {})\n'
    '    message_ts = message.get("ts")\n'
    '    channel_info = body.get("channel", {})\n'
    '    channel = channel_info.get("id") if isinstance(channel_info, dict) else str(channel_info or "")\n'
    '    log_line(f"claw_reject clicked by {user_id} ts={message_ts} channel={channel}")\n'
    '    if message_ts and message_ts in _PENDING_APPROVALS:\n'
    '        payload = _PENDING_APPROVALS.pop(message_ts, None)\n'
    '        task = (payload or {}).get("task", "Unknown task")\n'
    '        channel = (payload or {}).get("channel") or channel\n'
    '    else:\n'
    '        task = _extract_task_from_blocks(message.get("blocks", []))\n'
    '        log_line(f"claw_reject: orphan card, extracted task={task}")\n'
    '    if not channel:\n'
    '        log_line("claw_reject: no channel, aborting")\n'
    '        return\n'
    '    mark_queue_status(task, "rejected")\n'
    '    if message_ts:\n'
    '        try:\n'
    '            app.client.chat_update(\n'
    '                channel=channel,\n'
    '                ts=message_ts,\n'
    '                text=f"Rejected: {task}",\n'
    '                blocks=[\n'
    '                    {"type": "section", "text": {"type": "mrkdwn", "text": f"' + CROSS + ' *Rejected*\\n{task}"}},\n'
    '                    {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Rejected by <@{user_id}>"}]},\n'
    '                ],\n'
    '            )\n'
    '            log_line("claw_reject: card updated")\n'
    '        except Exception as exc:\n'
    '            log_line(f"claw_reject: card update failed: {exc}")\n'
)

# --- Apply patches ---
approve_pattern = re.compile(
    r'@app\.action\("claw_approve"\)\ndef on_claw_approve\(ack, body\):.*?(?=\n@app\.action\("claw_reject"\))',
    re.DOTALL,
)
m = approve_pattern.search(content)
if not m:
    print("ERROR: Could not find old on_claw_approve handler")
    exit(1)
print(f"Found old on_claw_approve at chars {m.start()}-{m.end()}")
content = content[:m.start()] + HELPER + "\n" + NEW_APPROVE + "\n" + content[m.end():]

reject_pattern = re.compile(
    r'@app\.action\("claw_reject"\)\ndef on_claw_reject\(ack, body\):.*?(?=\n@app\.action\("code_apply"\))',
    re.DOTALL,
)
m2 = reject_pattern.search(content)
if not m2:
    print("ERROR: Could not find old on_claw_reject handler")
    exit(1)
print(f"Found old on_claw_reject at chars {m2.start()}-{m2.end()}")
content = content[:m2.start()] + NEW_REJECT + "\n" + content[m2.end():]

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESS: slack_bot.py patched with orphan approval handling")