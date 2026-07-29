"""Builds an .xlsx workbook from a report's JSON data for download/email.

One small column-mapping function per report — the response shapes genuinely
differ (flat list / nested matrix / {by_status, bonus_paid, total}), so a
single generic mapper would need per-report special-casing anyway."""
import io
from openpyxl import Workbook


def _funnel_rows(data: list[dict]) -> tuple[list[str], list[list]]:
    headers = ["Stage", "Count"]
    rows = [[r["stage"], r["count"]] for r in data]
    return headers, rows


def _pipeline_rows(data: dict) -> tuple[list[str], list[list]]:
    stages = [s["stage"] for s in data.get("stages", [])]
    headers = ["Source", *stages, "Total"]
    rows = []
    for row in data.get("matrix", []):
        by_stage = {s["stage"]: s["count"] for s in row["by_stage"]}
        rows.append([row["source"], *[by_stage.get(s, 0) for s in stages], row["total"]])
    return headers, rows


def _trend_rows(data: list[dict]) -> tuple[list[str], list[list]]:
    headers = ["Period", "Source", "Count"]
    rows = [[r["bucket"], r["source"], r["count"]] for r in data]
    return headers, rows


def _job_rows(data: list[dict]) -> tuple[list[str], list[list]]:
    headers = ["Job", "Department", "Status", "Total Applications", "In Progress", "Hired", "Rejected", "Conversion %"]
    rows = [
        [j["title"], j["department"], j["status"], j["total_applications"],
         j["in_progress"], j["hired"], j["rejected"], j["conversion_rate"]]
        for j in data
    ]
    return headers, rows


def _source_rows(data: list[dict]) -> tuple[list[str], list[list]]:
    headers = ["Source", "Count"]
    rows = [[r["source"], r["count"]] for r in data]
    return headers, rows


def _referral_rows(data: dict) -> tuple[list[str], list[list]]:
    headers = ["Status", "Count"]
    rows = [[r["status"], r["count"]] for r in data.get("by_status", [])]
    rows.append(["Bonus Paid", data.get("bonus_paid", 0)])
    rows.append(["Total", data.get("total", 0)])
    return headers, rows


def _tth_rows(data: list[dict]) -> tuple[list[str], list[list]]:
    headers = ["Department", "Avg Days", "Min Days", "Max Days", "Hires"]
    rows = [[r["department"], r["avg_days"], r["min_days"], r["max_days"], r["count"]] for r in data]
    return headers, rows


def _agency_rows(data: list[dict]) -> tuple[list[str], list[list]]:
    headers = ["Agency", "Contact Email", "Submitted", "In Progress", "Hired", "Rejected", "Conversion %"]
    rows = [
        [a["agency_name"], a["contact_email"], a["total_submitted"], a["in_progress"],
         a["hired"], a["rejected"], a["conversion_rate"]]
        for a in data
    ]
    return headers, rows


_BUILDERS = {
    "funnel": _funnel_rows,
    "pipeline": _pipeline_rows,
    "trend": _trend_rows,
    "job": _job_rows,
    "source": _source_rows,
    "referral": _referral_rows,
    "tth": _tth_rows,
    "agency": _agency_rows,
}

REPORT_TITLES = {
    "funnel": "Hiring Funnel",
    "pipeline": "Pipeline Snapshot",
    "trend": "Applications Trend",
    "job": "By Job",
    "source": "Source Analysis",
    "referral": "Referral Performance",
    "tth": "Time to Hire",
    "agency": "Agency Performance",
}


def build_xlsx(report_key: str, data) -> bytes:
    if report_key not in _BUILDERS:
        raise ValueError(f"Unknown report key: {report_key}")
    headers, rows = _BUILDERS[report_key](data)

    wb = Workbook()
    ws = wb.active
    ws.title = REPORT_TITLES[report_key][:31]  # Excel sheet name limit
    ws.append(headers)
    for row in rows:
        ws.append(row)
    for col_idx in range(1, len(headers) + 1):
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = 20

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()
