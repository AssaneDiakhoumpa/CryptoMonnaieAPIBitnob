"""Paiements de masse : import CSV -> récap -> exécution -> suivi -> rapport."""
import csv
import io
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from app.bitnob.client import BitnobClient
from app.config import get_settings
from app.deps import get_client, require_api_key
from app.repo import get_repo
from app.repo.base import BatchRepository
from app.services import bulk, csv_import

router = APIRouter(prefix="/batches", tags=["batches"], dependencies=[Depends(require_api_key)])

Asset = Literal["BTC", "USDT", "USDC"]
Dest = Literal["bank", "mobile_money", "swift"]


def _repo() -> BatchRepository:
    return get_repo()


def _rejected(e: bulk.BatchRejected):
    return HTTPException(422, {"message": "Aucune ligne valide ou import strict refusé.",
                               "rejected_rows": e.rejected})


@router.post("", status_code=201)
async def upload_batch(
    file: UploadFile = File(..., description="CSV : name, account_number, bank_code, amount, currency, country"),
    name: str | None = Form(None),
    from_asset: Asset = Form("USDT"),
    payment_reason: str = Form("vendor_payment"),
    default_destination_type: Dest = Form("mobile_money"),
    strict: bool = Form(False, description="true = refuser tout le fichier si une ligne est invalide"),
    allow_duplicates: bool = Form(False),
    c: BitnobClient = Depends(get_client),
    repo: BatchRepository = Depends(_repo),
):
    raw = await file.read()
    if len(raw) > 1_000_000:
        raise HTTPException(413, "Fichier trop volumineux (1 Mo max).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        rows = csv_import.parse_csv(text)
        return await bulk.create_batch(
            c, repo, rows, name=name, from_asset=from_asset, payment_reason=payment_reason,
            default_destination=default_destination_type, strict=strict,
            allow_duplicates=allow_duplicates)
    except bulk.BatchRejected as e:
        raise _rejected(e)
    except ValueError as e:
        raise HTTPException(422, str(e))


class ManualRow(BaseModel):
    name: str
    account_number: str
    bank_code: str | None = None
    destination_type: Dest = "mobile_money"
    country: str = Field(examples=["GH"])
    amount: Decimal = Field(examples=["50"])
    currency: str = Field(examples=["GHS"])


class ManualBatch(BaseModel):
    name: str | None = None
    from_asset: Asset = "USDT"
    payment_reason: str = "vendor_payment"
    strict: bool = False
    allow_duplicates: bool = False
    beneficiaries: list[ManualRow] = Field(min_length=1)


@router.post("/manual", status_code=201)
async def manual_batch(body: ManualBatch, c: BitnobClient = Depends(get_client),
                       repo: BatchRepository = Depends(_repo)):
    """Même chose que le CSV, avec un tableau JSON (formulaire manuel du frontend)."""
    rows = [(i + 2, {k: ("" if v is None else str(v)) for k, v in r.model_dump().items()})
            for i, r in enumerate(body.beneficiaries)]
    try:
        return await bulk.create_batch(
            c, repo, rows, name=body.name, from_asset=body.from_asset,
            payment_reason=body.payment_reason, default_destination="mobile_money",
            strict=body.strict, allow_duplicates=body.allow_duplicates)
    except bulk.BatchRejected as e:
        raise _rejected(e)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("")
async def list_batches(repo: BatchRepository = Depends(_repo)):
    out = []
    for b in await repo.list_batches():
        out.append(bulk.recap(b, await repo.list_payouts(b.id)))
    return out


@router.get("/{batch_id}")
async def get_batch(batch_id: str, repo: BatchRepository = Depends(_repo)):
    batch = await repo.get_batch(batch_id)
    if batch is None:
        raise HTTPException(404, "Batch introuvable.")
    payouts = await repo.list_payouts(batch_id)
    return {**bulk.recap(batch, payouts), "payouts": [p.model_dump(mode="json", exclude={"quote"}) for p in payouts]}


@router.post("/{batch_id}/execute", status_code=202)
async def execute_batch(batch_id: str, background: BackgroundTasks,
                        c: BitnobClient = Depends(get_client), repo: BatchRepository = Depends(_repo)):
    """Lance les paiements en arrière-plan. Suivre avec GET /batches/{id}."""
    if not getattr(c, "mock", False) and not get_settings().confirm_payout:
        raise HTTPException(403, "Payout désactivé : CONFIRM_PAYOUT=true est requis.")
    try:
        await bulk.start_execution(repo, batch_id)
    except LookupError:
        raise HTTPException(404, "Batch introuvable.")
    except ValueError as e:
        raise HTTPException(409, str(e))
    background.add_task(bulk.run_batch, c, repo, batch_id)
    return {"batch_id": batch_id, "status": "RUNNING"}


@router.post("/{batch_id}/retry", status_code=202)
async def retry_batch(batch_id: str, background: BackgroundTasks,
                      c: BitnobClient = Depends(get_client), repo: BatchRepository = Depends(_repo)):
    """Relance les payouts FAILED/EXPIRED. Les UNCERTAIN ne sont jamais relancés."""
    if not getattr(c, "mock", False) and not get_settings().confirm_payout:
        raise HTTPException(403, "Payout désactivé : CONFIRM_PAYOUT=true est requis.")
    try:
        n = await bulk.prepare_retry(repo, batch_id)
    except LookupError:
        raise HTTPException(404, "Batch introuvable.")
    except ValueError as e:
        raise HTTPException(409, str(e))
    if n:
        background.add_task(bulk.run_batch, c, repo, batch_id)
    return {"batch_id": batch_id, "retried": n}


@router.post("/{batch_id}/refresh")
async def refresh_batch(batch_id: str, c: BitnobClient = Depends(get_client),
                        repo: BatchRepository = Depends(_repo)):
    """Polling de secours : interroge Bitnob (utile si un webhook est perdu, ou pour les UNCERTAIN)."""
    if await repo.get_batch(batch_id) is None:
        raise HTTPException(404, "Batch introuvable.")
    return await bulk.refresh_from_bitnob(c, repo, batch_id)


@router.get("/{batch_id}/report.csv")
async def report(batch_id: str, repo: BatchRepository = Depends(_repo)):
    batch = await repo.get_batch(batch_id)
    if batch is None:
        raise HTTPException(404, "Batch introuvable.")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["line", "name", "account_number", "country", "amount", "currency", "status",
                "fee", "reference", "bitnob_payout_id", "error"])
    for p in await repo.list_payouts(batch_id):
        w.writerow([p.line, p.name, p.account_number, p.country, p.amount, p.currency, p.status,
                    p.fee or "", p.reference, p.bitnob_payout_id or "", p.error or ""])
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="batch-{batch_id[:8]}.csv"'})
