#!/usr/bin/env python
"""
Ingest exported Actions Excel CSVs into SQLite.

Expected input: CSVs exported by scripts/actions_export.ps1 in data/actions_export/.
"""

import argparse
import csv
import json
import sqlite3
from pathlib import Path
from typing import Dict, Optional


def init_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS raw_rows (
            id INTEGER PRIMARY KEY,
            sheet_name TEXT,
            row_num INTEGER,
            data_json TEXT
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY,
            raw_id INTEGER,
            source_sheet TEXT,
            title TEXT,
            due_date TEXT,
            status TEXT,
            status_color TEXT,
            category TEXT,
            comments TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            FOREIGN KEY(raw_id) REFERENCES raw_rows(id)
        );
        CREATE INDEX IF NOT EXISTS idx_raw_sheet ON raw_rows(sheet_name);
        CREATE INDEX IF NOT EXISTS idx_tasks_sheet ON tasks(source_sheet);
        """
    )
    return conn


def normalize_header(h: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in h).strip("_")


def pick_value(row: Dict[str, str], *candidates: str) -> Optional[str]:
    key_map = {normalize_header(k): k for k in row.keys()}
    for cand in candidates:
        if cand in key_map:
            return row.get(key_map[cand])
    return None


def status_color(status: Optional[str]) -> Optional[str]:
    if not status:
        return None
    s = status.strip().lower()
    if s == "completed":
        return "green"
    if s in {"in-progress", "in progress", "pending"}:
        return "yellow"
    if s in {"not started", "not-started"}:
        return "red"
    return "yellow"


def ingest_csv(conn: sqlite3.Connection, path: Path) -> int:
    sheet_name = path.stem.replace("Actions-", "")
    with path.open("r", encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    cur = conn.cursor()
    inserted = 0
    for i, row in enumerate(rows, start=1):
        cur.execute(
            "INSERT INTO raw_rows (sheet_name, row_num, data_json) VALUES (?, ?, ?)",
            (sheet_name, i, json.dumps(row)),
        )
        raw_id = cur.lastrowid

        title = pick_value(row, "title", "actions", "task", "item", "seller_interview_questions")
        due_date = pick_value(row, "due_date", "next_due")
        status = pick_value(row, "status")
        comments = pick_value(row, "comments", "notes")

        if title is None or str(title).strip() == "":
            continue

        cur.execute(
            """
            INSERT INTO tasks
            (raw_id, source_sheet, title, due_date, status, status_color, category, comments, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))
            """,
            (
                raw_id,
                sheet_name,
                str(title).strip(),
                due_date,
                status,
                status_color(status),
                sheet_name,
                comments,
            ),
        )
        inserted += 1

    conn.commit()
    return inserted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True, help="Folder containing exported CSVs")
    parser.add_argument("--db", required=True, help="SQLite output path")
    parser.add_argument(
        "--sheets",
        default="",
        help="Comma-separated list of sheet names to include (after Actions- prefix).",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    db_path = Path(args.db)

    if args.sheets:
        allow = {s.strip() for s in args.sheets.split(",") if s.strip()}
        csv_files = [p for p in sorted(input_dir.glob("Actions-*.csv")) if p.stem.replace("Actions-", "") in allow]
    else:
        master = input_dir / "Actions-All_Tasks.csv"
        if master.exists():
            csv_files = [master]
        else:
            csv_files = sorted(input_dir.glob("Actions-*.csv"))

    conn = init_db(db_path)

    total = 0
    used = 0
    for csv_path in csv_files:
        used += 1
        total += ingest_csv(conn, csv_path)

    conn.close()
    print(f"Ingested {total} tasks from {used} CSVs into {db_path}")


if __name__ == "__main__":
    main()
