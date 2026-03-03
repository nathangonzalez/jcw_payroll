#!/usr/bin/env python3
"""
CFO agent baseline: classify QuickBooks transaction detail and output a KPI pack.

Usage:
  python scripts/cfo_agent.py --csv "C:\\Users\\natha\\Downloads\\Transaction Detail 03.03.2026.CSV"
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, help="QuickBooks transaction detail CSV path")
    parser.add_argument(
        "--out-dir",
        default="exports/cfo-agent",
        help="Output directory for KPI pack artifacts",
    )
    parser.add_argument(
        "--admin-weekly",
        type=float,
        default=16000.0,
        help="Owner-provided weekly admin payroll assumption",
    )
    parser.add_argument(
        "--loan-monthly",
        type=float,
        default=41000.0,
        help="Owner-provided monthly debt service assumption",
    )
    parser.add_argument(
        "--forecast-sde-annual",
        type=float,
        default=2200000.0,
        help="Forecast annual SDE",
    )
    parser.add_argument(
        "--target-sde-annual",
        type=float,
        default=1900000.0,
        help="Target annual SDE",
    )
    return parser.parse_args()


def parse_amount(raw: str) -> float:
    text = (raw or "").strip()
    if not text:
        return 0.0
    return float(text.replace(",", ""))


def parse_date(raw: str) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    for fmt in ("%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    return None


def month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower().strip())


def account_code(text: str) -> str:
    match = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?[a-z]?)", (text or "").lower())
    return match.group(1) if match else ""


def is_bank_account(account: str) -> bool:
    a = norm(account)
    code = account_code(a)
    return (
        any(k in a for k in ("bank", "checking", "climate first", "chase", "mma"))
        or code in {"99", "100", "101", "100.a", "101.a", "413", "430", "431"}
    )


@dataclass
class Totals:
    revenue: float = 0.0
    direct_cost: float = 0.0
    overhead: float = 0.0
    admin_payroll: float = 0.0
    loan_observed_cash: float = 0.0

    @property
    def gross_profit(self) -> float:
        return self.revenue - self.direct_cost

    @property
    def gross_margin_pct(self) -> float:
        if self.revenue <= 0:
            return 0.0
        return self.gross_profit / self.revenue

    @property
    def operating_predebt(self) -> float:
        return self.revenue - self.direct_cost - self.overhead


def classify_rows(rows: Iterable[Dict[str, str]]) -> Tuple[Totals, Dict[str, Totals], int]:
    period_totals = Totals()
    monthly: Dict[str, Totals] = defaultdict(Totals)
    parsed_rows = 0

    for row in rows:
        dt = parse_date(row.get("Date", ""))
        if not dt:
            continue
        parsed_rows += 1
        m = month_key(dt)
        amount = parse_amount(row.get("Amount", "0"))
        account = row.get("Account", "") or ""
        text = norm(
            " ".join(
                [
                    row.get("Type", "") or "",
                    account,
                    row.get("Split", "") or "",
                    row.get("Name", "") or "",
                    row.get("Memo", "") or "",
                ]
            )
        )
        code = account_code(account)

        # Revenue signal: QB invoice lines in "Construction Income" are negative amounts.
        if "construction income" in norm(account) and amount < 0:
            value = -amount
            period_totals.revenue += value
            monthly[m].revenue += value

        # Direct job costs.
        if code.startswith(("705", "706", "707", "710")) and amount > 0:
            period_totals.direct_cost += amount
            monthly[m].direct_cost += amount

        # Overhead bucket.
        if code.startswith("8") and amount > 0:
            period_totals.overhead += amount
            monthly[m].overhead += amount

        # Explicit admin payroll.
        if code.startswith("811") or "admin payroll" in text:
            if amount > 0:
                period_totals.admin_payroll += amount
                monthly[m].admin_payroll += amount

        # Observed cash outflows tagged as loan/note/interest from bank-side entries.
        if (
            is_bank_account(account)
            and amount < 0
            and any(k in text for k in ("loan", "note", "interest"))
        ):
            value = -amount
            period_totals.loan_observed_cash += value
            monthly[m].loan_observed_cash += value

    return period_totals, monthly, parsed_rows


def fmt_money(value: float) -> str:
    return f"${value:,.2f}"


def main() -> int:
    args = parse_args()
    csv_path = Path(args.csv)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    with csv_path.open("r", encoding="cp1252", newline="") as fh:
        reader = csv.DictReader(fh)
        totals, monthly, parsed_rows = classify_rows(reader)

    months = sorted(monthly.keys())
    if not months:
        raise RuntimeError("No dated rows were parsed from CSV.")

    last_month = months[-1]
    full_months = months[:-1] if len(months) > 1 else months

    def avg_for(field: str, use_full_only: bool = True) -> float:
        keys = full_months if use_full_only else months
        if not keys:
            return 0.0
        return sum(getattr(monthly[k], field) for k in keys) / len(keys)

    avg_monthly_revenue = avg_for("revenue")
    avg_monthly_direct = avg_for("direct_cost")
    avg_monthly_overhead = avg_for("overhead")
    avg_monthly_admin_observed = avg_for("admin_payroll")
    avg_monthly_loan_observed = avg_for("loan_observed_cash")

    admin_monthly_assumption = args.admin_weekly * 52.0 / 12.0
    fixed_monthly_assumption = admin_monthly_assumption + args.loan_monthly
    gross_margin_pct = totals.gross_margin_pct
    break_even_sales = (
        fixed_monthly_assumption / gross_margin_pct if gross_margin_pct > 0 else 0.0
    )

    monthly_operating_predebt = avg_monthly_revenue - avg_monthly_direct - avg_monthly_overhead
    monthly_after_fixed = monthly_operating_predebt - fixed_monthly_assumption
    annualized_sde_proxy = monthly_after_fixed * 12.0
    forecast_gap = annualized_sde_proxy - args.forecast_sde_annual
    target_gap = annualized_sde_proxy - args.target_sde_annual

    kpi = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_csv": str(csv_path),
        "rows_parsed": parsed_rows,
        "date_range_months": {"all": months, "full_months_used_for_avg": full_months},
        "period_totals": {
            "revenue": totals.revenue,
            "direct_cost": totals.direct_cost,
            "gross_profit": totals.gross_profit,
            "gross_margin_pct": gross_margin_pct,
            "overhead": totals.overhead,
            "admin_payroll_observed": totals.admin_payroll,
            "loan_cash_observed": totals.loan_observed_cash,
        },
        "monthly_averages_full_months": {
            "revenue": avg_monthly_revenue,
            "direct_cost": avg_monthly_direct,
            "overhead": avg_monthly_overhead,
            "admin_payroll_observed": avg_monthly_admin_observed,
            "loan_cash_observed": avg_monthly_loan_observed,
            "operating_predebt": monthly_operating_predebt,
        },
        "owner_assumptions": {
            "admin_weekly": args.admin_weekly,
            "admin_monthly_implied": admin_monthly_assumption,
            "loan_monthly": args.loan_monthly,
            "fixed_monthly_total": fixed_monthly_assumption,
        },
        "break_even": {
            "break_even_sales_monthly": break_even_sales,
            "break_even_sales_annualized": break_even_sales * 12.0,
        },
        "sde_tracking_proxy": {
            "monthly_after_fixed_costs": monthly_after_fixed,
            "annualized_proxy": annualized_sde_proxy,
            "forecast_sde_annual": args.forecast_sde_annual,
            "target_sde_annual": args.target_sde_annual,
            "vs_forecast_gap": forecast_gap,
            "vs_target_gap": target_gap,
        },
        "notes": [
            "Revenue uses Account='Construction Income' invoice lines (negative amounts inverted).",
            "Direct cost uses account codes 705/706/707/710 with positive amounts.",
            "Overhead uses account code prefix 8xx with positive amounts.",
            "Loan observed cash can include one-time events; owner-provided monthly loan assumption is used for break-even.",
        ],
    }

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = out_dir / f"cfo_kpi_{stamp}.json"
    monthly_csv = out_dir / f"cfo_monthly_{stamp}.csv"
    latest_json = out_dir / "latest-cfo-kpi.json"
    latest_csv = out_dir / "latest-cfo-monthly.csv"

    json_path.write_text(json.dumps(kpi, indent=2), encoding="utf-8")
    latest_json.write_text(json.dumps(kpi, indent=2), encoding="utf-8")

    with monthly_csv.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "month",
                "revenue",
                "direct_cost",
                "gross_profit",
                "overhead",
                "admin_payroll_observed",
                "loan_cash_observed",
                "operating_predebt",
            ]
        )
        for m in months:
            t = monthly[m]
            writer.writerow(
                [
                    m,
                    f"{t.revenue:.2f}",
                    f"{t.direct_cost:.2f}",
                    f"{(t.revenue - t.direct_cost):.2f}",
                    f"{t.overhead:.2f}",
                    f"{t.admin_payroll:.2f}",
                    f"{t.loan_observed_cash:.2f}",
                    f"{(t.revenue - t.direct_cost - t.overhead):.2f}",
                ]
            )
    latest_csv.write_text(monthly_csv.read_text(encoding="utf-8"), encoding="utf-8")

    print("CFO Agent KPI Pack generated")
    print(f"- JSON: {json_path}")
    print(f"- Monthly CSV: {monthly_csv}")
    print(f"- Rows parsed: {parsed_rows}")
    print(f"- Avg monthly revenue (full months): {fmt_money(avg_monthly_revenue)}")
    print(f"- Gross margin: {gross_margin_pct * 100:.2f}%")
    print(f"- Break-even monthly sales: {fmt_money(break_even_sales)}")
    print(f"- SDE annualized proxy: {fmt_money(annualized_sde_proxy)}")
    print(f"- Gap vs forecast (2.2M): {fmt_money(forecast_gap)}")
    print(f"- Gap vs target (1.9M): {fmt_money(target_gap)}")
    print(f"- Last (partial) month in source: {last_month}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
