"""Orchestration des paiements de masse : import, exécution, relance, suivi.

Règles de sécurité (pour ne jamais payer deux fois) :
- un batch ne s'exécute qu'une fois (DRAFT -> RUNNING) ;
- chaque payout a une `reference` unique, envoyée à Bitnob ;
- si `finalize` échoue de façon ambiguë (timeout, 5xx), le payout passe en UNCERTAIN :
  il n'est JAMAIS relancé automatiquement, il faut le vérifier (POST /batches/{id}/refresh) ;
- seuls les payouts FAILED / EXPIRED sont relancés, avec une nouvelle référence.
"""
import asyncio
import logging
import time
from decimal import Decimal, InvalidOperation

import httpx

from app.bitnob import payouts as payouts_api
from app.bitnob.client import BitnobClient, BitnobError
from app.config import get_settings
from app.domain import IN_FLIGHT, TERMINAL, Batch, Payout, now
from app.repo.base import BatchRepository
from app.schemas import Beneficiary, QuoteIn
from app.services import csv_import

log = logging.getLogger("bulk")
BACKOFF = 1.0
_COUNTRY_CACHE: dict = {"ts": 0.0, "codes": None}
_RUNNING: set[str] = set()


class BatchRejected(Exception):
    def __init__(self, rejected: list[dict]):
        self.rejected = rejected


# ------------------------------------------------------------------ import
def _collect_codes(obj, out: set[str]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in {"country", "country_code", "countrycode", "iso2", "code", "alpha2"} \
                    and isinstance(v, str) and len(v) == 2 and v.isalpha():
                out.add(v.upper())
            else:
                _collect_codes(v, out)
    elif isinstance(obj, list):
        for x in obj:
            _collect_codes(x, out)


async def supported_country_codes(client: BitnobClient) -> set[str] | None:
    """Pays supportés par Bitnob (cache 10 min). None si on ne peut pas les lire :
    dans ce cas on ne rejette pas sur ce critère."""
    if _COUNTRY_CACHE["codes"] is not None and time.time() - _COUNTRY_CACHE["ts"] < 600:
        return _COUNTRY_CACHE["codes"]
    try:
        resp = await payouts_api.supported_countries(client)
    except Exception:
        return None
    codes: set[str] = set()
    _collect_codes(resp, codes)
    _COUNTRY_CACHE.update(ts=time.time(), codes=codes or None)
    return codes or None


async def create_batch(client: BitnobClient, repo: BatchRepository, rows: list[tuple[int, dict]], *,
                       name: str | None, from_asset: str, payment_reason: str,
                       default_destination: str, strict: bool, allow_duplicates: bool) -> dict:
    supported = await supported_country_codes(client)
    valid, rejected = csv_import.validate_rows(
        rows, default_destination, supported, allow_duplicates, get_settings().bulk_max_rows)
    if rejected and strict:
        raise BatchRejected(rejected)
    if not valid:
        raise BatchRejected(rejected)

    batch = Batch(name=name or f"Batch {now():%Y-%m-%d %H:%M}", from_asset=from_asset,
                  payment_reason=payment_reason)
    prefix = batch.id.split("-")[0]
    payouts = [Payout(batch_id=batch.id, reference=f"BP-{prefix}-{v['line']:04d}", **v) for v in valid]
    await repo.create_batch(batch, payouts)

    warnings = []
    if supported is None:
        warnings.append("Pays supportés non vérifiés (liste Bitnob illisible).")
    return recap(batch, payouts, rejected, warnings)


def recap(batch: Batch, payouts: list[Payout], rejected: list[dict] | None = None,
          warnings: list[str] | None = None) -> dict:
    totals: dict[str, Decimal] = {}
    countries: dict[str, int] = {}
    statuses: dict[str, int] = {}
    for p in payouts:
        totals[p.currency] = totals.get(p.currency, Decimal(0)) + p.amount
        countries[p.country] = countries.get(p.country, 0) + 1
        statuses[p.status] = statuses.get(p.status, 0) + 1
    return {
        "batch": batch.model_dump(mode="json"),
        "beneficiaries_count": len(payouts),
        "rejected_count": len(rejected or []),
        "totals_by_currency": {k: str(v) for k, v in totals.items()},
        "countries": countries,
        "payouts_by_status": statuses,
        "estimated_fees": None,  # les devis expirent vite : les frais réels sont dans payout.fee après exécution
        "rejected_rows": rejected or [],
        "warnings": warnings or [],
    }


# --------------------------------------------------------------- exécution
def _err_text(e: Exception) -> str:
    if isinstance(e, BitnobError):
        p = e.payload if isinstance(e.payload, dict) else {}
        err = p.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])
        return str(p.get("detail") or p.get("message") or p)[:300]
    return f"{type(e).__name__}: {e}"[:300]


async def _with_retry(factory, attempts: int = 3):
    """Réessaie UNIQUEMENT les étapes sans effet financier (quote)."""
    for i in range(attempts):
        try:
            return await factory()
        except BitnobError as e:
            if (e.status_code == 429 or e.status_code >= 500) and i < attempts - 1:
                await asyncio.sleep(BACKOFF * (i + 1))
                continue
            raise
        except httpx.HTTPError:
            if i < attempts - 1:
                await asyncio.sleep(BACKOFF * (i + 1))
                continue
            raise


def _first(d: dict, *keys):
    for k in keys:
        if d.get(k):
            return d[k]
    return None


def _fee(quote: dict) -> Decimal | None:
    v = _first(quote, "fee", "fees", "total_fee", "fee_amount")
    try:
        return Decimal(str(v)) if v is not None else None
    except InvalidOperation:
        return None


async def _process(client: BitnobClient, repo: BatchRepository, batch: Batch, p: Payout) -> None:
    if p.attempts == 0:
        p.reference = await repo.start_payout_attempt(p.id)
    stage = "quote"
    callback = get_settings().webhook_url
    try:
        q = await _with_retry(lambda: payouts_api.create_quote(client, QuoteIn(
            settlement_amount=str(p.amount), country=p.country, from_asset=batch.from_asset,
            to_currency=p.currency, source="offchain", reference=p.reference)))
        p.quote_id = _first(q, "quote_id", "id")
        if not p.quote_id:
            raise ValueError("devis sans identifiant")
        p.quote, p.fee, p.status = q, _fee(q), "QUOTED"
        await repo.save_payout(p)

        stage = "initialize"
        init = await payouts_api.initialize(
            client, p.quote_id,
            Beneficiary(destination_type=p.destination_type, country=p.country, account_name=p.name,
                        account_number=p.account_number, bank_code=p.bank_code),
            batch.payment_reason, reference=p.reference, callback_url=callback)
        p.bitnob_payout_id = _first(init, "id", "payout_id") or p.bitnob_payout_id
        p.status = "INITIATED"
        await repo.save_payout(p)
        if not await repo.apply_payout_status(p, origin="api"):
            raise RuntimeError("La base a refusé la transition vers INITIATED.")

        stage = "finalize"
        fin = await payouts_api.finalize(client, p.quote_id)
        p.bitnob_payout_id = _first(fin, "id", "payout_id") or p.bitnob_payout_id
        p.status = "SUBMITTED"
        if not await repo.apply_payout_status(p, origin="api"):
            raise RuntimeError("La base a refusé la transition vers SUBMITTED.")
    except (BitnobError, httpx.HTTPError, ValueError) as e:
        ambiguous = stage == "finalize" and (
            not isinstance(e, BitnobError) or e.status_code >= 500)
        p.status = "UNCERTAIN" if ambiguous else "FAILED"
        p.error, p.error_stage = _err_text(e), stage
        log.warning("payout %s -> %s (%s): %s", p.reference, p.status, stage, p.error)
        if not await repo.apply_payout_status(p, origin="api"):
            raise RuntimeError(f"La base a refusé le statut {p.status} du paiement.")


async def run_batch(client: BitnobClient, repo: BatchRepository, batch_id: str) -> None:
    try:
        batch = await repo.get_batch(batch_id)
        todo = [p for p in await repo.list_payouts(batch_id) if p.status == "PENDING"]
        sem = asyncio.Semaphore(get_settings().bulk_concurrency)

        async def one(p: Payout):
            async with sem:
                await _process(client, repo, batch, p)

        await asyncio.gather(*(one(p) for p in todo))
        await refresh_batch_status(repo, batch_id)
    finally:
        _RUNNING.discard(batch_id)


async def start_execution(repo: BatchRepository, batch_id: str) -> Batch:
    """Verrouille le batch (DRAFT/VALIDATED -> RUNNING). Lève ValueError si déjà lancé."""
    batch = await repo.get_batch(batch_id)
    if batch is None:
        raise LookupError("batch introuvable")
    if batch.status not in {"DRAFT", "VALIDATED"} or batch_id in _RUNNING:
        raise ValueError(f"batch déjà lancé (statut {batch.status})")
    _RUNNING.add(batch_id)
    batch.status, batch.executed_at = "RUNNING", now()
    await repo.save_batch(batch)
    return batch


async def prepare_retry(repo: BatchRepository, batch_id: str) -> int:
    """Remet en PENDING les payouts FAILED/EXPIRED (nouvelle référence). UNCERTAIN exclus."""
    batch = await repo.get_batch(batch_id)
    if batch is None:
        raise LookupError("batch introuvable")
    if batch.status in {"DRAFT", "VALIDATED", "CANCELLED"} or batch_id in _RUNNING:
        raise ValueError("rien à relancer (batch non exécuté ou en cours)")
    n = 0
    for p in await repo.list_payouts(batch_id):
        if p.status in {"FAILED", "EXPIRED"}:
            p.attempts += 1
            p.status, p.error, p.error_stage = "PENDING", None, None
            p.quote_id = p.bitnob_payout_id = p.quote = p.fee = p.completed_at = None
            p.reference = await repo.start_payout_attempt(p.id)
            await repo.save_payout(p)
            n += 1
    if n:
        _RUNNING.add(batch_id)
        batch.status = "RUNNING"
        await repo.save_batch(batch)
    return n


# ------------------------------------------------------------------- statuts
def derive_batch_status(batch: Batch, payouts: list[Payout]) -> str:
    if batch.status == "CANCELLED":
        return "CANCELLED"
    if batch.executed_at is None:
        return batch.status if batch.status == "VALIDATED" else "DRAFT"
    statuses = {p.status for p in payouts}
    if statuses & IN_FLIGHT:
        return "RUNNING"
    if statuses == {"SUCCESS"}:
        return "COMPLETED"
    if "SUCCESS" not in statuses:
        return "FAILED"
    return "PARTIAL"


async def refresh_batch_status(repo: BatchRepository, batch_id: str) -> Batch | None:
    batch = await repo.get_batch(batch_id)
    if batch is None:
        return None
    new = derive_batch_status(batch, await repo.list_payouts(batch_id))
    if new != batch.status:
        batch.status = new
        await repo.save_batch(batch)
    return batch


def _map_bitnob_status(raw: str | None) -> str | None:
    s = (raw or "").upper()
    return {"COMPLETED": "SUCCESS", "SUCCESS": "SUCCESS", "SUCCESSFUL": "SUCCESS", "PAID": "SUCCESS",
            "FAILED": "FAILED", "CANCELLED": "FAILED", "EXPIRED": "EXPIRED",
            "PENDING": "PROCESSING", "PROCESSING": "PROCESSING", "INITIATED": "INITIATED"}.get(s)


async def _apply_status(repo: BatchRepository, p: Payout, new: str, *,
                        origin: str = "api", event_id: str | None = None) -> bool:
    if p.status == "SUCCESS" or p.status == new:
        return False
    if new in {"INITIATED", "PROCESSING"} and p.status in TERMINAL:
        return False
    previous_status, previous_completed_at, previous_error = p.status, p.completed_at, p.error
    p.status = new
    if new == "SUCCESS":
        p.completed_at, p.error = now(), None
    if not await repo.apply_payout_status(p, origin=origin, event_id=event_id):
        p.status, p.completed_at, p.error = previous_status, previous_completed_at, previous_error
        return False
    await refresh_batch_status(repo, p.batch_id)
    return True


async def apply_webhook(repo: BatchRepository, event: str, data: dict,
                        event_id: str | None = None) -> None:
    new = {"payouts.initialized": "INITIATED", "payouts.processing": "PROCESSING",
           "payouts.withdrawal.success": "SUCCESS",
           "payouts.withdrawal.expired": "EXPIRED"}.get(event)
    if new is None:
        return
    p = await repo.find_payout(reference=data.get("reference"),
                               bitnob_payout_id=_first(data, "id", "payout_id", "payoutId"))
    if p is None:
        log.info("webhook %s : payout inconnu (%s)", event, data.get("reference"))
        return
    await _apply_status(repo, p, new, origin="webhook", event_id=event_id)


async def refresh_from_bitnob(client: BitnobClient, repo: BatchRepository, batch_id: str) -> dict:
    """Polling de secours : interroge Bitnob pour les payouts non terminés."""
    updated, errors = 0, []
    for p in await repo.list_payouts(batch_id):
        if p.status in {"SUBMITTED", "PROCESSING", "UNCERTAIN", "INITIATED"} and p.bitnob_payout_id:
            try:
                info = await payouts_api.get_payout(client, p.bitnob_payout_id)
            except BitnobError as e:
                errors.append({"reference": p.reference, "error": _err_text(e)})
                continue
            new = _map_bitnob_status(info.get("status"))
            if new and await _apply_status(repo, p, new):
                updated += 1
    await refresh_batch_status(repo, batch_id)
    return {"updated": updated, "errors": errors}
