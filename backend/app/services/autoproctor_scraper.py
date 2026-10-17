"""AutoProctor admin-site scraper — pure I/O, no database. The nightly sync
(autoproctor_service.run_sync) drives it.

How the site works, as observed 2026-10-17:
  * Login is passwordless: enter the admin email, AutoProctor mails a 6-digit
    code from hello@autoproctor.co with the code in the SUBJECT
    ("935806 is your AutoProctor Login Code"), type it into six one-digit
    boxes, click Verify. We read that mail through MS Graph (Mail.Read).
  * The site's load balancer returns 403 to anything that announces itself as
    a bot or headless browser, so the browser runs with a regular Chrome UA.
  * Its JSON API needs a Bearer token the web app attaches itself, so rather
    than calling it directly we drive the pages and read the JSON responses
    the pages fetch (page.on("response")).
  * Latest attempts: /api/v3/test-attempts/?…&limit=100, newest first, only
    finished attempts; scrolling to the bottom loads the next 100.
  * Report page: Results / Proctoring / Auxiliary device tabs. "Download All
    responses" (Results) is a real .xlsx download, but it holds EVERY
    candidate's responses for that test, so we fetch it once per test per run
    and slice out each candidate. The two "Download Report" buttons just call
    window.print(); we used to reproduce them with page.pdf(), but loading and
    printing ~150 evidence photos crashed Chromium on a 1 GB worker, so the
    PDFs were dropped (2026-10-17) — HR opens the evidence in AutoProctor.
"""
import asyncio
import io
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BASE = "https://www.autoproctor.co"
LOGIN_URL = f"{BASE}/account/login/role/test-admin?next=https%3A%2F%2Fwww.autoproctor.co%2Ftest-admin%2Flatest-attempts%2F"
LATEST_URL = f"{BASE}/test-admin/latest-attempts/"
CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)
OTP_REGEX = re.compile(r"\b(\d{6})\b")

# Proctoring-tab counter labels -> our violation keys. Matched loosely
# (case-insensitive, any suffix) because the page and its print layout word
# them slightly differently ("TAB SWITCHES" vs "TAB SWITCHED").
VIOLATION_LABELS = {
    "tab_switched": r"tab\s+switch\w*",
    "no_face": r"no\s+face\s+detected",
    "multiple_faces": r"multiple\s+faces",
    "noise": r"noise\s+detected",
    "exited_fullscreen": r"exited\s+full\s*screen",
    "multiple_monitors": r"multiple\s+monitors",
}


class AutoproctorError(Exception):
    pass


def report_url(attempt_label: str) -> str:
    return f"{BASE}/test-admin/test-attempts/{attempt_label}/report/?t=p"


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _hundredths(value) -> Optional[float]:
    return None if value is None else round(value / 100, 2)


# ── Login code from the mailbox ──────────────────────────────────────────────

async def fetch_login_otp(requested_at: datetime, timeout_s: int = 150, poll_s: int = 4) -> str:
    """Wait for an AutoProctor login code that arrived after requested_at.

    requested_at must be captured BEFORE the "Sign In With Email" click, so a
    code from an earlier login can never be picked up."""
    from app.services.ms_graph_service import GRAPH_BASE, _get_app_token

    if not settings.ms_graph_configured:
        raise AutoproctorError("MS Graph is not configured — can't read the login code")

    cutoff = (requested_at - timedelta(seconds=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = f"{GRAPH_BASE}/users/{settings.AUTOPROCTOR_LOGIN_EMAIL}/messages"
    params = {
        "$filter": f"receivedDateTime ge {cutoff}",
        "$orderby": "receivedDateTime desc",
        "$top": "10",
        "$select": "from,subject,bodyPreview,receivedDateTime",
    }
    sender = settings.AUTOPROCTOR_OTP_SENDER.lower()
    deadline = asyncio.get_event_loop().time() + timeout_s
    async with httpx.AsyncClient(timeout=20) as client:
        while asyncio.get_event_loop().time() < deadline:
            token = await _get_app_token()
            resp = await client.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
            resp.raise_for_status()
            for msg in resp.json().get("value", []):
                frm = ((msg.get("from") or {}).get("emailAddress") or {}).get("address", "").lower()
                if sender not in frm:
                    continue
                for text in (msg.get("subject"), msg.get("bodyPreview")):
                    m = OTP_REGEX.search(text or "")
                    if m:
                        return m.group(1)
            await asyncio.sleep(poll_s)
    raise AutoproctorError(f"No AutoProctor login code reached {settings.AUTOPROCTOR_LOGIN_EMAIL} within {timeout_s}s")


# ── Responses workbook ───────────────────────────────────────────────────────

def slice_responses(xlsx: bytes, email: str) -> tuple[Optional[bytes], list[dict]]:
    """Cut one candidate out of a test's "Download All responses" workbook.

    Returns (a workbook with just their rows + the Questions sheet, a
    question-by-question list for the portal). (None, []) when the candidate
    isn't in the file — e.g. AutoProctor hadn't flushed it yet."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(xlsx), read_only=True, data_only=True)
    sheets = {ws.title: list(ws.iter_rows(values_only=True)) for ws in wb.worksheets}
    email = email.strip().lower()

    def candidate_row(rows):
        if not rows:
            return None, None
        header = list(rows[0])
        for r in rows[1:]:
            if r and isinstance(r[0], str) and r[0].strip().lower() == email:
                return header, list(r)
        return header, None

    points_header, points_row = candidate_row(sheets.get("Points", []))
    resp_header, resp_row = candidate_row(sheets.get("Responses", []))
    if points_row is None and resp_row is None:
        return None, []

    questions = {}
    for r in (sheets.get("Questions") or [])[1:]:
        if r and r[0] is not None:
            questions[str(r[0]).strip()] = {"question": r[1], "max_points": r[2]}

    def by_number(header, row):
        out = {}
        if not header or not row:
            return out
        for h, v in zip(header, row):
            m = re.match(r"^(\d+)\.\s", str(h or ""))
            if m:
                out[m.group(1)] = v
        return out

    pts = by_number(points_header, points_row)
    ans = by_number(resp_header, resp_row)
    numbers = sorted(set(questions) | set(pts) | set(ans), key=lambda n: int(n) if n.isdigit() else 0)
    responses = [
        {
            "number": int(n) if n.isdigit() else n,
            "question": (questions.get(n) or {}).get("question"),
            "answer": None if ans.get(n) is None else str(ans.get(n)),
            "points": pts.get(n),
            "max_points": (questions.get(n) or {}).get("max_points"),
        }
        for n in numbers
    ]

    out = openpyxl.Workbook()
    out.remove(out.active)
    for title, header, row in (("Points", points_header, points_row), ("Responses", resp_header, resp_row)):
        if header:
            ws = out.create_sheet(title)
            ws.append(header)
            if row:
                ws.append(row)
    if sheets.get("Questions"):
        ws = out.create_sheet("Questions")
        for r in sheets["Questions"]:
            ws.append(list(r))
    buf = io.BytesIO()
    out.save(buf)
    return buf.getvalue(), responses


# ── Browser session ──────────────────────────────────────────────────────────

class AutoproctorSession:
    """`async with AutoproctorSession() as ap:` launches Chromium and logs in.
    One login per run — a fresh code each night is simpler than persisting a
    session cookie across container restarts."""

    def __init__(self):
        self._pw = None
        self._browser = None
        self.ctx = None

    async def __aenter__(self):
        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        # --no-sandbox: the container runs as root, where Chromium's sandbox
        # refuses to start. --disable-dev-shm-usage: /dev/shm is tiny in
        # containers and big report pages crash the renderer without it.
        self._browser = await self._pw.chromium.launch(
            headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        self.ctx = await self._browser.new_context(
            user_agent=CHROME_UA, viewport={"width": 1440, "height": 900}, accept_downloads=True,
        )
        self.ctx.set_default_timeout(60_000)
        await self._login()
        return self

    async def __aexit__(self, *exc):
        try:
            if self._browser:
                await self._browser.close()
        finally:
            if self._pw:
                await self._pw.stop()

    async def _login(self):
        page = await self.ctx.new_page()
        try:
            await page.goto(LOGIN_URL, wait_until="domcontentloaded")
            try:
                await page.get_by_role("button", name="OK, I accept").click(timeout=4000)
            except Exception:
                pass  # cookie banner only shows on a fresh context, and not always
            await page.fill("#email-desktop", settings.AUTOPROCTOR_LOGIN_EMAIL)
            requested_at = datetime.now(timezone.utc)
            await page.click("#sign-in-button-desktop")
            await page.get_by_role("button", name="Verify", exact=True).wait_for(timeout=60_000)

            code = await fetch_login_otp(requested_at)
            boxes = [
                el for el in await page.query_selector_all("input")
                if await el.is_visible() and (await el.get_attribute("type")) not in ("hidden", "email", "checkbox")
            ]
            if len(boxes) >= 6:
                for box, digit in zip(boxes, code):
                    await box.fill(digit)
            elif boxes:
                await boxes[0].fill(code)
            else:
                raise AutoproctorError("Login code boxes not found on the verify page")
            await page.get_by_role("button", name="Verify", exact=True).click()
            await page.wait_for_url("**/test-admin/**", timeout=60_000)
            logger.info("AutoProctor login ok")
        finally:
            await page.close()

    # ── Latest attempts ──

    async def list_attempts(self, since: datetime, max_pages: int = 30) -> list[dict]:
        """Every finished attempt that STARTED on/after `since`, newest first,
        as AutoProctor's list rows. Scrolls for more until the oldest loaded
        row predates `since` or the list runs out."""
        pages: list[dict] = []
        got = asyncio.Event()

        async def on_response(resp):
            if "/api/v3/test-attempts/?" in resp.url and resp.request.method == "GET":
                try:
                    pages.append(await resp.json())
                    got.set()
                except Exception:
                    pass

        page = await self.ctx.new_page()
        page.on("response", on_response)
        try:
            await page.goto(LATEST_URL, wait_until="domcontentloaded")
            for _ in range(max_pages):
                try:
                    await asyncio.wait_for(got.wait(), timeout=30)
                except asyncio.TimeoutError:
                    break
                got.clear()
                last = pages[-1]
                rows = last.get("data") or []
                oldest = _parse_dt(rows[-1].get("test_client_start_time")) if rows else None
                if not last.get("has_more") or (oldest and oldest < since):
                    break
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        finally:
            await page.close()

        seen, out = set(), []
        for p in pages:
            for row in p.get("data") or []:
                label = row.get("label")
                started = _parse_dt(row.get("test_client_start_time"))
                if not label or label in seen or not row.get("test_finish_time"):
                    continue
                if started and started < since:
                    continue
                seen.add(label)
                out.append(row)
        return out

    # ── One attempt ──

    async def _open_report(self, attempt_label: str):
        captured: dict[str, dict] = {}

        async def on_response(resp):
            url = resp.url
            if f"/test-attempts/{attempt_label}/" not in url:
                return
            try:
                data = await resp.json()
            except Exception:
                return
            if "/api/v3/" in url and "/report" not in url:
                captured["v3"] = data
            elif url.rstrip("/").endswith("aux-video-upload"):
                captured["aux"] = data
            elif re.search(r"/api/v2/test-attempts/[^/]+/?$", url.split("?")[0]):
                captured["v2"] = data

        page = await self.ctx.new_page()
        page.on("response", on_response)
        # The report page streams evidence media and never goes network-idle.
        await page.goto(report_url(attempt_label), wait_until="domcontentloaded")
        await page.get_by_role("tab", name="Proctoring").wait_for(timeout=60_000)
        for _ in range(30):
            if "v3" in captured:
                break
            await page.wait_for_timeout(500)
        await page.wait_for_timeout(3000)
        return page, captured

    @staticmethod
    async def _read_violations(page) -> dict:
        text = await page.inner_text("body")
        out = {}
        for key, pattern in VIOLATION_LABELS.items():
            m = re.search(pattern + r"\s*\n?\s*(\d+)", text, flags=re.I)
            out[key] = int(m.group(1)) if m else None
        return out

    async def scrape_attempt(self, attempt_label: str) -> dict:
        """Top-level data and the proctoring violation counters. The report
        PDFs are deliberately not generated: printing them crashed Chromium
        out of memory on the 1 GB worker, and the photo evidence is one click
        away in AutoProctor itself."""
        page, captured = await self._open_report(attempt_label)
        try:
            v3 = captured.get("v3") or {}
            v3 = v3.get("data", v3)  # the detail endpoint wraps its payload in {"data": …}
            if not v3.get("test_taker"):
                raise AutoproctorError(f"Attempt {attempt_label}: report data never loaded")
            await page.get_by_role("tab", name="Proctoring").click()
            # The counters render after the tab's own data arrives — wait for
            # them rather than a fixed sleep, or a slow load reads them as blank.
            try:
                await page.wait_for_function(
                    "() => /tab\\s+switch\\w*\\s+\\d+/i.test(document.body.innerText)", timeout=30_000,
                )
            except Exception:
                logger.warning(f"Attempt {attempt_label}: violation counters didn't render")
            violations = await self._read_violations(page)
        finally:
            await page.close()

        v2 = (captured.get("v2") or {}).get("test_attempt") or {}
        aux = (captured.get("aux") or {}).get("aux_device_video_upload") or {}
        test = v3.get("test") or {}
        taker = v3.get("test_taker") or {}
        name = " ".join(x for x in (taker.get("first_name"), taker.get("last_name")) if x).strip()
        return {
            "attempt_label": attempt_label,
            "test_label": test.get("label"),
            "test_title": test.get("title") or "",
            "candidate_email": (taker.get("email") or "").strip().lower(),
            "candidate_name": name or None,
            "started_at": _parse_dt(v3.get("test_client_start_time")),
            "finished_at": _parse_dt(v3.get("test_finish_time")),
            "duration_seconds": v3.get("duration_seconds"),
            "device_type": v3.get("device_type"),
            "trust_score_pct": v3.get("trust_score_pct"),
            "percentage_scored": _hundredths(v3.get("percentage_scored_times_hundred")),
            "points_scored": _hundredths(v3.get("points_scored_times_hundred")),
            "points_available": _hundredths(test.get("soc_points_available_times_hundred")),
            "graded": bool(v3.get("graded")),
            "violations": violations,
            "aux_device_verified": (v2.get("misc_data") or {}).get("auxiliary_device_verified"),
            "aux_video_url": aux.get("evidence_url"),
            # test_settings is a large static blob of plan/credit config — not worth keeping per row.
            "raw": {k: v for k, v in v3.items() if k != "test_settings"},
        }

    async def download_test_responses(self, attempt_label: str) -> bytes:
        """The test-wide "Download All responses" workbook, reached through
        any one attempt's Results tab."""
        page, _ = await self._open_report(attempt_label)
        try:
            await page.get_by_role("tab", name="Results").click()
            await page.wait_for_timeout(3000)
            async with page.expect_download(timeout=120_000) as info:
                await page.get_by_role("button", name="Download All responses").click()
            download = await info.value
            path = await download.path()
            with open(path, "rb") as fh:
                return fh.read()
        finally:
            await page.close()
