from fastapi import APIRouter, Depends, HTTPException

from app.bitnob import payouts as svc
from app.bitnob.client import BitnobClient
from app.config import get_settings
from app.deps import get_client, require_api_key
from app.schemas import Beneficiary, PayoutIn, QuoteIn

router = APIRouter(dependencies=[Depends(require_api_key)])


def _callback() -> str | None:
    base = get_settings().public_base_url
    return f"{base}/webhooks/bitnob" if base else None


@router.get("/whoami", tags=["system"])
async def whoami(c: BitnobClient = Depends(get_client)):
    """Vérifie que Client ID / Secret / signature HMAC fonctionnent."""
    return await c.get("/api/whoami")


@router.get("/balances", tags=["wallet"])
async def balances(c: BitnobClient = Depends(get_client)):
    return await c.get("/api/balances")


# ---- Payouts : référentiels ----
@router.get("/payouts/countries", tags=["payouts"])
async def countries(c: BitnobClient = Depends(get_client)):
    return await svc.supported_countries(c)


@router.get("/payouts/countries/{country}", tags=["payouts"])
async def country(country: str, c: BitnobClient = Depends(get_client)):
    return await svc.country_details(c, country.upper())


@router.get("/payouts/banks/{country}", tags=["payouts"])
async def banks(country: str, c: BitnobClient = Depends(get_client)):
    return await svc.banks(c, country.upper())


# ---- Payouts : étapes séparées ----
@router.post("/payout/quote", tags=["payouts"])
async def quote(body: QuoteIn, c: BitnobClient = Depends(get_client)):
    return await svc.create_quote(c, body)


@router.post("/payout/{quote_id}/initialize", tags=["payouts"])
async def initialize(
    quote_id: str,
    beneficiary: Beneficiary,
    payment_reason: str = "vendor_payment",
    c: BitnobClient = Depends(get_client),
):
    return await svc.initialize(c, quote_id, beneficiary, payment_reason, callback_url=_callback())


@router.post("/payout/{quote_id}/finalize", tags=["payouts"])
async def finalize(quote_id: str, c: BitnobClient = Depends(get_client)):
    if not getattr(c, "mock", False) and not get_settings().confirm_payout:
        raise HTTPException(403, "Payout désactivé : CONFIRM_PAYOUT=true est requis.")
    return await svc.finalize(c, quote_id)


@router.get("/payout/{payout_id}", tags=["payouts"])
async def get_payout(payout_id: str, c: BitnobClient = Depends(get_client)):
    return await svc.get_payout(c, payout_id)


# ---- Payouts : tout-en-un (sera réutilisé par /bulk_payout) ----
@router.post("/payout", tags=["payouts"])
async def payout(body: PayoutIn, c: BitnobClient = Depends(get_client)):
    if not getattr(c, "mock", False) and not get_settings().confirm_payout:
        raise HTTPException(403, "Payout désactivé : CONFIRM_PAYOUT=true est requis.")
    q = await svc.create_quote(c, body.quote)
    init = await svc.initialize(
        c, q["quote_id"], body.beneficiary, body.payment_reason,
        reference=body.reference, callback_url=_callback(),
    )
    fin = await svc.finalize(c, q["quote_id"])
    return {"quote": q, "initialized": init, "finalized": fin}
