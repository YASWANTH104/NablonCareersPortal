"""Zoho Sign e-signature for offer letters.

Flow: HR picks the parties → we render the letter with anchored signature
slots, upload it to Zoho, place a Signature + Date field on each signer's line
and submit. Zoho emails each party in turn. Its webhook (with a 30-minute poll
as a safety net) triggers sync_request(), which reads the request back from
Zoho as the source of truth and moves the offer along:

    all signed          → offer accepted (signed PDF + certificate stay in Zoho,
                          fetched on demand by fetch_signed_document)
    signatory declines  → director_rejected   (HR edits and resends)
    candidate declines  → rejected
    anyone else declines→ signature_declined  (HR edits and resends)
    expired             → expired
    recalled            → draft
"""
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.esign import OfferSignatureRequest, OfferSigner, OfferSignatureEvent, EsignSettings
from app.models.offer import OfferLetter
from app.schemas.esign import EsignSendRequest, EsignSettingsUpdate
from app.services import zoho_sign_client as zoho
from app.services.zoho_sign_client import ZohoSignError

logger = logging.getLogger(__name__)

ROLE_ACTION = {
    "company_signatory": "SIGN",
    "candidate": "SIGN",
    "signer": "SIGN",
    "approver": "APPROVER",
    "viewer": "VIEW",
}
# A party is "done" once it reaches one of these
DONE_STATUSES = ("signed", "approved", "declined")
_STATUS_RANK = {"pending": 0, "notified": 1, "viewed": 2, "signed": 3, "approved": 3, "declined": 3}
REMIND_COOLDOWN = timedelta(hours=1)
PT_PER_PX = 0.75  # WeasyPrint lays out in CSS px (1/96 in); Zoho places fields in PDF points


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _raise_zoho(exc: ZohoSignError):
    raise HTTPException(exc.status_code, exc.message)


# ── Settings ─────────────────────────────────────────────────────────────────

async def get_settings(db: AsyncSession) -> EsignSettings:
    row = await db.get(EsignSettings, 1)
    if row is None:
        row = EsignSettings(id=1, default_parties=[], expiration_days=14, reminder_days=3)
        db.add(row)
        await db.flush()
    return row


def serialize_settings(cfg: EsignSettings) -> dict:
    return {
        "signatory_name": cfg.signatory_name or settings.DIRECTOR_NAME or "",
        "signatory_email": cfg.signatory_email or settings.DIRECTOR_EMAIL or "",
        "default_parties": list(cfg.default_parties or []),
        "expiration_days": cfg.expiration_days,
        "reminder_days": cfg.reminder_days,
        "note": cfg.note or "",
    }


async def update_settings(db: AsyncSession, data: EsignSettingsUpdate, user_id: uuid.UUID) -> EsignSettings:
    cfg = await get_settings(db)
    cfg.signatory_name = (data.signatory_name or "").strip() or None
    cfg.signatory_email = str(data.signatory_email).lower() if data.signatory_email else None
    cfg.default_parties = [
        {"name": p.name.strip(), "email": str(p.email).lower(), "role": p.role}
        for p in data.default_parties
    ]
    cfg.expiration_days = data.expiration_days
    cfg.reminder_days = data.reminder_days
    cfg.note = (data.note or "").strip() or None
    cfg.updated_by = user_id
    await db.commit()
    await db.refresh(cfg)
    return cfg


def integration_status(base_url: str) -> dict:
    # TLS ends at the Container Apps ingress, so the app itself sees plain http
    if settings.is_production and base_url.startswith("http://"):
        base_url = "https://" + base_url[len("http://"):]
    return {
        "configured": zoho.is_configured(),
        "webhook_configured": bool(settings.ZOHO_SIGN_WEBHOOK_SECRET),
        "missing_keys": zoho.missing_keys(),
        "api_base": settings.ZOHO_SIGN_API_BASE,
        "webhook_url": f"{base_url.rstrip('/')}{settings.API_V1_PREFIX}/esign/webhook/zoho",
    }


async def test_connection() -> dict:
    try:
        users = await zoho.list_users(force=True)
    except ZohoSignError as exc:
        return {"ok": False, "message": exc.message}
    return {"ok": True, "message": f"Connected — {len(users)} active Zoho Sign user(s) found.", "users": len(users)}


# ── Queries ──────────────────────────────────────────────────────────────────

async def _latest_request(db: AsyncSession, offer_id: uuid.UUID, *, lock: bool = False) -> Optional[OfferSignatureRequest]:
    q = (
        select(OfferSignatureRequest)
        .where(OfferSignatureRequest.offer_id == offer_id)
        .order_by(OfferSignatureRequest.created_at.desc())
        .limit(1)
    )
    if lock:
        q = q.with_for_update()
    return (await db.execute(q)).scalar_one_or_none()


async def _signers(db: AsyncSession, request_id: uuid.UUID) -> list[OfferSigner]:
    return list((await db.execute(
        select(OfferSigner)
        .where(OfferSigner.signature_request_id == request_id)
        .order_by(OfferSigner.signing_order, OfferSigner.name)
    )).scalars().all())


def _counts_toward_progress(s: OfferSigner) -> bool:
    # Copy-only recipients never act, so they don't count as "signed / total"
    return s.action_type in ("SIGN", "APPROVER")


def _waiting_on(req: OfferSignatureRequest, signers: list[OfferSigner]) -> list[OfferSigner]:
    """The parties Zoho is currently waiting on."""
    if req.status != "inprogress":
        return []
    pending = [s for s in signers if _counts_toward_progress(s) and s.status not in DONE_STATUSES]
    if not pending:
        return []
    if req.is_sequential:
        first = min(s.signing_order for s in pending)
        return [s for s in pending if s.signing_order == first]
    return pending


def _summary(req: OfferSignatureRequest, signers: list[OfferSigner]) -> dict:
    acting = [s for s in signers if _counts_toward_progress(s)]
    return {
        "id": str(req.id),
        "status": req.status,
        "signed_count": sum(1 for s in acting if s.status in ("signed", "approved")),
        "total_signers": len(acting),
        "waiting_on": [s.name for s in _waiting_on(req, signers)],
        "sent_at": req.sent_at,
        "expires_at": req.expires_at,
        "completed_at": req.completed_at,
    }


async def summaries_for_offers(db: AsyncSession, offer_ids: list[uuid.UUID]) -> dict:
    """Latest envelope summary per offer, for the offers list and offer detail."""
    if not offer_ids:
        return {}
    latest = (
        select(
            OfferSignatureRequest.id,
            func.row_number().over(
                partition_by=OfferSignatureRequest.offer_id,
                order_by=OfferSignatureRequest.created_at.desc(),
            ).label("rn"),
        )
        .where(OfferSignatureRequest.offer_id.in_(offer_ids))
        .subquery()
    )
    reqs = (await db.execute(
        select(OfferSignatureRequest).join(latest, latest.c.id == OfferSignatureRequest.id).where(latest.c.rn == 1)
    )).scalars().all()
    if not reqs:
        return {}
    signers = (await db.execute(
        select(OfferSigner)
        .where(OfferSigner.signature_request_id.in_([r.id for r in reqs]))
        .order_by(OfferSigner.signing_order)
    )).scalars().all()
    by_req: dict = {}
    for s in signers:
        by_req.setdefault(s.signature_request_id, []).append(s)
    return {r.offer_id: _summary(r, by_req.get(r.id, [])) for r in reqs}


def _signer_dict(s: OfferSigner) -> dict:
    return {
        "id": str(s.id),
        "role": s.role,
        "action_type": s.action_type,
        "name": s.name,
        "email": s.email,
        "signing_order": s.signing_order,
        "source": s.source,
        "status": s.status,
        "viewed_at": s.viewed_at,
        "signed_at": s.signed_at,
        "decline_reason": s.decline_reason,
    }


async def get_detail(db: AsyncSession, offer_id: uuid.UUID) -> dict:
    offer = await db.get(OfferLetter, offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    req = await _latest_request(db, offer_id)
    if not req:
        return {"offer_status": offer.status, "request": None, "signers": [], "events": [], "previous_requests": 0}

    signers = await _signers(db, req.id)
    events = (await db.execute(
        select(OfferSignatureEvent)
        .where(OfferSignatureEvent.signature_request_id == req.id)
        .order_by(OfferSignatureEvent.occurred_at.desc())
        .limit(50)
    )).scalars().all()
    previous = (await db.execute(
        select(func.count()).select_from(OfferSignatureRequest).where(OfferSignatureRequest.offer_id == offer_id)
    )).scalar_one() - 1

    last_reminder = next((e.occurred_at for e in events if e.event_type == "reminded"), None)
    waiting = {s.id for s in _waiting_on(req, signers)}
    return {
        "offer_status": offer.status,
        "request": {
            **_summary(req, signers),
            "is_sequential": req.is_sequential,
            "expiration_days": req.expiration_days,
            "reminder_days": req.reminder_days,
            "note": req.note,
            "last_synced_at": req.last_synced_at,
            "last_reminded_at": last_reminder,
            "has_signed_pdf": req.status == "completed",
            "error": req.error,
        },
        "signers": [{**_signer_dict(s), "is_current": s.id in waiting} for s in signers],
        "events": [
            {
                "id": str(e.id),
                "event_type": e.event_type,
                "actor_name": e.actor_name,
                "actor_email": e.actor_email,
                "detail": e.detail,
                "occurred_at": e.occurred_at,
            }
            for e in events
        ],
        "previous_requests": max(0, previous),
    }


async def candidate_view(db: AsyncSession, offer: OfferLetter) -> Optional[dict]:
    """Where the candidate stands in the signing order — never other parties' emails."""
    req = await _latest_request(db, offer.id)
    if not req:
        return None
    signers = await _signers(db, req.id)
    me = next((s for s in signers if s.role == "candidate"), None)
    acting = [s for s in signers if _counts_toward_progress(s)]
    waiting = _waiting_on(req, signers)
    return {
        "status": req.status,
        "email": me.email if me else None,
        "my_status": me.status if me else None,
        "my_turn": bool(me and me in waiting),
        "my_position": (acting.index(me) + 1) if me in acting else None,
        "total_signers": len(acting),
        "signed_count": sum(1 for s in acting if s.status in ("signed", "approved")),
        "waiting_on": [s.name for s in waiting if s is not me],
        "is_sequential": req.is_sequential,
        "expires_at": req.expires_at,
        "signed_pdf_available": bool(offer.esign_completed_at),
    }


# ── Events ───────────────────────────────────────────────────────────────────

async def _record_event(
    db: AsyncSession,
    req: OfferSignatureRequest,
    event_type: str,
    dedupe_key: str,
    *,
    actor: Optional[OfferSigner] = None,
    actor_name: Optional[str] = None,
    actor_email: Optional[str] = None,
    detail: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    await db.execute(
        pg_insert(OfferSignatureEvent)
        .values(
            id=uuid.uuid4(),
            signature_request_id=req.id,
            event_type=event_type,
            actor_name=actor.name if actor else actor_name,
            actor_email=actor.email if actor else actor_email,
            detail=detail,
            payload=payload,
            dedupe_key=dedupe_key[:255],
            occurred_at=_now(),
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
    )


# ── Send ─────────────────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _field(kind: str, place: dict, document_id: str, action_id: str) -> dict:
    from app.services.offer_service import ESIGN_SIG_SIZE_PX, ESIGN_DATE_SIZE_PX

    w, h = ESIGN_SIG_SIZE_PX if kind == "sig" else ESIGN_DATE_SIZE_PX
    x, y = place["x"], place["y"]
    if kind == "sig":
        # The slot is 56px tall with the signature line right under it — sit the field on the line
        y += 56 - h - 2
    pw, ph = place["page_width"], place["page_height"]
    is_sig = kind == "sig"
    return {
        "field_type_name": "Signature" if is_sig else "Date",
        "field_category": "image" if is_sig else "datefield",
        "field_label": "Signature" if is_sig else "Sign Date",
        "field_name": "Signature" if is_sig else "Sign Date",
        "is_mandatory": True,
        "document_id": document_id,
        "action_id": action_id,
        "page_no": place["page_no"],
        "x_coord": round(x * PT_PER_PX),
        "y_coord": round(y * PT_PER_PX),
        "abs_width": round(w * PT_PER_PX),
        "abs_height": round(h * PT_PER_PX),
        "x_value": round(x / pw * 100, 4),
        "y_value": round(y / ph * 100, 4),
        "width": round(w / pw * 100, 4),
        "height": round(h / ph * 100, 4),
    }


def _match_actions(zoho_actions: list[dict], parties: list[dict]) -> dict:
    """Zoho's create response → our party index → action_id. Matched on email
    + signing order; one person can't appear twice (we dedupe emails)."""
    out: dict = {}
    remaining = list(zoho_actions)
    for i, p in enumerate(parties):
        hit = next(
            (a for a in remaining if (a.get("recipient_email") or "").lower() == p["email"]),
            None,
        )
        if hit is None:
            raise ZohoSignError("Zoho Sign didn't return a recipient we sent. Nothing was sent — please try again.")
        remaining.remove(hit)
        out[i] = str(hit["action_id"])
    return out


async def send_for_signature(
    db: AsyncSession, offer_id: uuid.UUID, data: EsignSendRequest, user_id: uuid.UUID,
) -> dict:
    from app.models.application import Application
    from app.models.user import User
    from app.services import offer_service
    from app.services.document_service import is_documents_complete

    if not zoho.is_configured():
        raise HTTPException(503, "Zoho Sign isn't connected yet. Ask an admin to add the Zoho keys.")

    offer = (await db.execute(
        select(OfferLetter).where(OfferLetter.id == offer_id).with_for_update()
    )).scalar_one_or_none()
    if not offer:
        raise HTTPException(404, "Offer not found")
    if offer.status not in offer_service.EDITABLE_STATUSES:
        raise HTTPException(400, f"This offer is already {offer.status.replace('_', ' ')} — it can't be sent again right now.")
    if not offer.template_id:
        raise HTTPException(400, "Pick a letter template before sending for signature.")
    if not await is_documents_complete(db, offer.application_id):
        raise HTTPException(400, "Cannot send offer letter — candidate has not submitted all required documents yet.")

    cand_name, cand_email = (await db.execute(
        select(User.full_name, User.email)
        .join(Application, Application.applicant_id == User.id)
        .where(Application.id == offer.application_id)
    )).one()
    cand_email = (cand_email or "").strip().lower()

    # ── Validate parties ──
    parties: list[dict] = []
    seen: set[str] = set()
    for p in data.parties:
        email = str(p.email).strip().lower()
        if p.role == "candidate":
            # The candidate always signs as themselves, whatever the client sent
            email, name = cand_email, cand_name or p.name
        else:
            name = p.name
        if not _EMAIL_RE.match(email):
            raise HTTPException(422, f"{name}: that email address doesn't look right.")
        if email in seen:
            raise HTTPException(422, f"{email} is added more than once — each party needs their own email.")
        seen.add(email)
        parties.append({
            "role": p.role, "name": name, "email": email, "source": p.source,
            "title": (p.title or "").strip() or None, "action_type": ROLE_ACTION[p.role],
        })

    roles = [p["role"] for p in parties]
    if roles.count("company_signatory") != 1:
        raise HTTPException(422, "Add exactly one company signatory — the person signing for Nablon.")
    if roles.count("candidate") != 1:
        raise HTTPException(422, "The candidate must be one of the parties.")

    # Render keys: the two fixed lines, then p1..pn for additional signers
    extra = 0
    for p in parties:
        if p["role"] in ("company_signatory", "candidate"):
            p["key"] = p["role"]
        elif p["action_type"] == "SIGN":
            extra += 1
            p["key"] = f"p{extra}"
    sign_parties = [
        {"key": p["key"], "name": p["name"], "title": p["title"] or "Signatory"}
        for p in parties if p["action_type"] == "SIGN"
    ]

    pdf_bytes, placements = await offer_service.build_offer_esign_pdf(db, offer_id, sign_parties)
    for sp in sign_parties:
        if "sig" not in placements.get(sp["key"], {}):
            logger.error(f"E-sign render: no signature anchor for {sp['key']} on offer {offer_id}")
            raise HTTPException(500, "Couldn't find where to place a signature on this letter. Check the template's signature block.")

    # ── Create + submit in Zoho ──
    note = (data.note or "").strip() or None
    request_json = {
        "request_name": f"Offer Letter — {cand_name}"[:100],
        "is_sequential": data.is_sequential,
        "expiration_days": data.expiration_days,
        "email_reminders": bool(data.reminder_days),
        "reminder_period": data.reminder_days or 0,
        "notes": note or "",
        "actions": [
            {
                "action_type": p["action_type"],
                "recipient_name": p["name"],
                "recipient_email": p["email"],
                "signing_order": i + 1,
                "verify_recipient": False,
                "private_notes": "",
            }
            for i, p in enumerate(parties)
        ],
    }
    if not data.reminder_days:
        request_json.pop("reminder_period")

    filename = re.sub(r"[^A-Za-z0-9 _-]", "", f"Offer Letter - {cand_name}").strip() + ".pdf"
    try:
        created = await zoho.create_request(pdf_bytes, filename, request_json)
    except ZohoSignError as exc:
        _raise_zoho(exc)

    zoho_request_id = str(created["request_id"])
    try:
        document_id = str(created["document_ids"][0]["document_id"])
        action_ids = _match_actions(created.get("actions") or [], parties)
        submit_actions = []
        for i, p in enumerate(parties):
            action = {
                "action_id": action_ids[i],
                "recipient_name": p["name"],
                "recipient_email": p["email"],
                "action_type": p["action_type"],
            }
            if p["action_type"] == "SIGN":
                place = placements[p["key"]]
                fields = [_field("sig", place["sig"], document_id, action_ids[i])]
                if "date" in place:
                    fields.append(_field("date", place["date"], document_id, action_ids[i]))
                action["fields"] = fields
            submit_actions.append(action)
        await zoho.submit_request(zoho_request_id, submit_actions)
    except (ZohoSignError, KeyError, IndexError, TypeError) as exc:
        # Don't leave a half-made draft sitting in the Zoho account
        try:
            await zoho.delete_request(zoho_request_id)
        except ZohoSignError:
            logger.warning(f"Couldn't clean up Zoho draft {zoho_request_id}")
        if isinstance(exc, ZohoSignError):
            _raise_zoho(exc)
        logger.exception(f"Unexpected Zoho create response for offer {offer_id}")
        raise HTTPException(502, "Zoho Sign returned something unexpected. Nothing was sent — please try again.")

    # ── Persist ──
    now = _now()
    req = OfferSignatureRequest(
        offer_id=offer_id,
        zoho_request_id=zoho_request_id,
        zoho_document_id=document_id,
        status="inprogress",
        is_sequential=data.is_sequential,
        expiration_days=data.expiration_days,
        reminder_days=data.reminder_days,
        note=note,
        sent_by=user_id,
        sent_at=now,
        expires_at=now + timedelta(days=data.expiration_days),
        last_synced_at=now,
    )
    db.add(req)
    await db.flush()
    for i, p in enumerate(parties):
        db.add(OfferSigner(
            signature_request_id=req.id,
            role=p["role"],
            action_type=p["action_type"],
            name=p["name"],
            email=p["email"],
            signing_order=i + 1,
            source=p["source"],
            zoho_action_id=action_ids[i],
            status="notified" if (not data.is_sequential or i == 0) else "pending",
        ))
    sender = await db.get(User, user_id)
    await _record_event(
        db, req, "sent", f"{req.id}:sent",
        actor_name=sender.full_name if sender else None,
        actor_email=sender.email if sender else None,
        detail=f"Sent to {len(parties)} {'party' if len(parties) == 1 else 'parties'}"
               + (" in order" if data.is_sequential else " at once"),
    )

    offer.status = "pending_signatures"
    offer.sent_at = now
    offer.expires_at = req.expires_at
    offer.esign_completed_at = None
    offer.updated_at = now
    await db.commit()
    return await get_detail(db, offer_id)


# ── Sync from Zoho (webhook / poll / manual refresh) ─────────────────────────

def _map_action_status(raw: Optional[str]) -> Optional[str]:
    r = (raw or "").upper().replace(" ", "")
    if not r:
        return None
    if "DECLIN" in r or "REJECT" in r:
        return "declined"
    if "APPROV" in r:
        return "approved"
    if r in ("SIGNED", "COMPLETED") or r.endswith("SIGNED"):
        return "signed"
    if r == "UNOPENED" or r == "INPROGRESS":
        return "notified"
    if "VIEW" in r or r == "OPENED":
        return "viewed"
    if r == "NOACTION":
        return "pending"
    return None


def _action_reason(action: dict) -> Optional[str]:
    for k in ("decline_reason", "declined_reason", "reason", "reject_reason"):
        if action.get(k):
            return str(action[k])[:1000]
    return None


async def sync_request(db: AsyncSession, request_id: uuid.UUID) -> Optional[str]:
    """Pull the envelope from Zoho and apply it. Idempotent and row-locked, so
    a webhook burst (signed + completed land together) can't double-complete.
    Returns the request status, or None if there's nothing to sync."""
    req = (await db.execute(
        select(OfferSignatureRequest).where(OfferSignatureRequest.id == request_id).with_for_update()
    )).scalar_one_or_none()
    if not req or not req.zoho_request_id or req.status != "inprogress":
        return req.status if req else None

    try:
        data = await zoho.get_request(req.zoho_request_id)
    except ZohoSignError as exc:
        req.error = exc.message
        req.last_synced_at = _now()
        await db.commit()
        raise

    now = _now()
    signers = await _signers(db, req.id)
    by_action = {s.zoho_action_id: s for s in signers if s.zoho_action_id}
    by_email = {s.email: s for s in signers}

    for action in data.get("actions") or []:
        s = by_action.get(str(action.get("action_id"))) or by_email.get((action.get("recipient_email") or "").lower())
        new = _map_action_status(action.get("action_status"))
        if not s or not new or _STATUS_RANK[new] <= _STATUS_RANK.get(s.status, 0):
            continue
        s.status = new
        if new == "viewed":
            s.viewed_at = s.viewed_at or now
        elif new in ("signed", "approved"):
            s.signed_at = now
            s.viewed_at = s.viewed_at or now
        elif new == "declined":
            s.decline_reason = s.decline_reason or _action_reason(action)
        if new != "notified":
            await _record_event(
                db, req, new, f"{req.id}:{s.id}:{new}", actor=s,
                detail=s.decline_reason if new == "declined" else None,
            )

    # In order: whoever is next in line has now been emailed by Zoho
    for s in _waiting_on(req, signers):
        if s.status == "pending":
            s.status = "notified"

    zstatus = (data.get("request_status") or "").lower()
    req.last_synced_at = now
    req.error = None
    offer = await db.get(OfferLetter, req.offer_id)

    if zstatus == "completed":
        await _complete(db, req, offer, signers)
    elif zstatus == "declined" or any(s.status == "declined" for s in signers):
        await _declined(db, req, offer, signers)
    elif zstatus == "expired":
        req.status = "expired"
        await _record_event(db, req, "expired", f"{req.id}:expired", detail="The signing link expired")
        if offer and offer.status == "pending_signatures":
            offer.status = "expired"
            offer.updated_at = now
    elif zstatus == "recalled":
        req.status = "recalled"
        await _record_event(db, req, "recalled", f"{req.id}:recalled", detail="Recalled in Zoho Sign")
        if offer and offer.status == "pending_signatures":
            offer.status = "draft"
            offer.updated_at = now

    await db.commit()
    return req.status


async def _complete(db: AsyncSession, req: OfferSignatureRequest, offer: OfferLetter, signers: list[OfferSigner]) -> None:
    now = _now()
    for s in signers:
        if s.action_type in ("SIGN", "APPROVER") and s.status not in ("signed", "approved"):
            s.status = "signed" if s.action_type == "SIGN" else "approved"
            s.signed_at = s.signed_at or now
    req.status = "completed"
    req.completed_at = now
    await _record_event(db, req, "completed", f"{req.id}:completed", detail="Everyone has signed")

    if offer and offer.status == "pending_signatures":
        candidate = next((s for s in signers if s.role == "candidate"), None)
        offer.status = "accepted"
        offer.accepted_at = now
        offer.signed_at = (candidate.signed_at if candidate else None) or now
        offer.esign_completed_at = now
        offer.updated_at = now
        await db.flush()
        _after_commit_tasks(db).append(("notify_hr_offer_accepted", str(offer.id)))


async def _declined(db: AsyncSession, req: OfferSignatureRequest, offer: OfferLetter, signers: list[OfferSigner]) -> None:
    decliner = next((s for s in signers if s.status == "declined"), None)
    req.status = "declined"
    if not offer or offer.status != "pending_signatures":
        return
    role = decliner.role if decliner else None
    offer.status = {
        "company_signatory": "director_rejected",
        "candidate": "rejected",
    }.get(role, "signature_declined")
    offer.updated_at = _now()
    await db.flush()
    _after_commit_tasks(db).append(("notify_hr_offer_signature_declined", str(offer.id)))


def _after_commit_tasks(db: AsyncSession) -> list:
    return db.info.setdefault("esign_after_commit", [])


def dispatch_after_commit(db: AsyncSession) -> None:
    """Queue the HR emails a sync decided on — only once its commit has landed."""
    from app.tasks import email_tasks
    for task_name, arg in db.info.pop("esign_after_commit", []):
        try:
            getattr(email_tasks, task_name).delay(arg)
        except Exception:
            logger.exception(f"Couldn't queue {task_name} for {arg}")


async def refresh(db: AsyncSession, offer_id: uuid.UUID) -> dict:
    req = await _latest_request(db, offer_id)
    if not req:
        raise HTTPException(404, "This offer hasn't been sent for signature")
    try:
        await sync_request(db, req.id)
    except ZohoSignError as exc:
        _raise_zoho(exc)
    dispatch_after_commit(db)
    return await get_detail(db, offer_id)


# ── Webhook ──────────────────────────────────────────────────────────────────

async def handle_webhook(db: AsyncSession, payload: dict) -> Optional[uuid.UUID]:
    """Records what Zoho told us (mainly decline reasons, which the request
    read-back doesn't always carry) and returns our request id to sync, or None
    for documents that aren't ours."""
    reqs = payload.get("requests") or {}
    notif = payload.get("notifications") or {}
    zoho_id = str(reqs.get("request_id") or "")
    if not zoho_id:
        return None
    req = (await db.execute(
        select(OfferSignatureRequest).where(OfferSignatureRequest.zoho_request_id == zoho_id)
    )).scalar_one_or_none()
    if not req:
        return None

    reason = notif.get("reason") or notif.get("decline_reason")
    actor_email = (notif.get("performed_by_email") or "").lower()
    op = str(notif.get("operation_type") or "")
    if reason and actor_email and ("reject" in op.lower() or "declin" in op.lower()):
        signer = (await db.execute(
            select(OfferSigner).where(
                OfferSigner.signature_request_id == req.id, OfferSigner.email == actor_email,
            )
        )).scalar_one_or_none()
        if signer and not signer.decline_reason:
            signer.decline_reason = str(reason)[:1000]
            await db.commit()
    return req.id


# ── HR actions ───────────────────────────────────────────────────────────────

async def remind(db: AsyncSession, offer_id: uuid.UUID, user) -> dict:
    req = await _latest_request(db, offer_id)
    if not req or req.status != "inprogress":
        raise HTTPException(400, "There's no signature request waiting on anyone right now.")
    last = (await db.execute(
        select(func.max(OfferSignatureEvent.occurred_at)).where(
            OfferSignatureEvent.signature_request_id == req.id,
            OfferSignatureEvent.event_type == "reminded",
        )
    )).scalar_one_or_none()
    if last and _now() - last < REMIND_COOLDOWN:
        mins = max(1, int((REMIND_COOLDOWN - (_now() - last)).total_seconds() // 60))
        raise HTTPException(429, f"A reminder just went out. You can send another in {mins} min.")
    try:
        await zoho.remind(req.zoho_request_id)
    except ZohoSignError as exc:
        _raise_zoho(exc)
    waiting = _waiting_on(req, await _signers(db, req.id))
    await _record_event(
        db, req, "reminded", f"{req.id}:reminded:{_now().isoformat()}",
        actor_name=user.full_name, actor_email=user.email,
        detail="Reminder sent to " + (", ".join(s.name for s in waiting) or "pending parties"),
    )
    await db.commit()
    return await get_detail(db, offer_id)


async def recall_live_request(db: AsyncSession, offer: OfferLetter, *, reason: str, user=None) -> None:
    """Pulls the live envelope back in Zoho. Doesn't commit — callers do."""
    req = await _latest_request(db, offer.id, lock=True)
    if not req or req.status != "inprogress":
        return
    try:
        await zoho.recall(req.zoho_request_id)
    except ZohoSignError as exc:
        # Usually means it finished or was recalled on Zoho's side in the meantime;
        # surface it so HR refreshes rather than silently diverging from Zoho
        logger.warning(f"Zoho recall failed for {req.zoho_request_id}: {exc.message}")
        _raise_zoho(exc)
    req.status = "recalled"
    await _record_event(
        db, req, "recalled", f"{req.id}:recalled",
        actor_name=user.full_name if user else None,
        actor_email=user.email if user else None,
        detail="Offer revoked" if reason == "revoked" else "Recalled to edit the letter",
    )


async def recall(db: AsyncSession, offer_id: uuid.UUID, user) -> dict:
    offer = (await db.execute(
        select(OfferLetter).where(OfferLetter.id == offer_id).with_for_update()
    )).scalar_one_or_none()
    if not offer:
        raise HTTPException(404, "Offer not found")
    if offer.status != "pending_signatures":
        raise HTTPException(400, "Only an offer that's out for signature can be recalled.")
    await recall_live_request(db, offer, reason="edit", user=user)
    offer.status = "draft"
    offer.updated_at = _now()
    await db.commit()
    return await get_detail(db, offer_id)


async def fetch_signed_document(db: AsyncSession, offer_id: uuid.UUID, kind: str) -> bytes:
    """Signed PDF ("pdf") or Zoho's completion certificate ("certificate"),
    pulled live from Zoho. Deliberately never written to blob or disk — the
    signed letter carries salary and personal details, and anyone with access
    to the storage account could otherwise read it. Zoho stays the only copy."""
    req = (await db.execute(
        select(OfferSignatureRequest)
        .where(OfferSignatureRequest.offer_id == offer_id, OfferSignatureRequest.status == "completed")
        .order_by(OfferSignatureRequest.completed_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if not req or not req.zoho_request_id:
        raise HTTPException(404, "This offer hasn't been signed by everyone yet")
    try:
        if kind == "certificate":
            return await zoho.download_certificate(req.zoho_request_id)
        return await zoho.download_pdf(req.zoho_request_id)
    except ZohoSignError as exc:
        logger.warning(f"Fetching signed {kind} for offer {offer_id} from Zoho failed: {exc.message}")
        what = "completion certificate" if kind == "certificate" else "signed letter"
        raise HTTPException(502, f"Couldn't fetch the {what} from Zoho Sign right now. Please try again in a moment.")


async def inflight_request_ids(db: AsyncSession, older_than: timedelta) -> list[uuid.UUID]:
    cutoff = _now() - older_than
    return list((await db.execute(
        select(OfferSignatureRequest.id).where(
            OfferSignatureRequest.status == "inprogress",
            (OfferSignatureRequest.last_synced_at.is_(None)) | (OfferSignatureRequest.last_synced_at < cutoff),
        )
    )).scalars().all())
