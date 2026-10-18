"""Factures Bitcoin (Lightning) avec QR code."""
import io

import segno
from fastapi import APIRouter, Depends, HTTPException, Response

from app.bitnob import lightning as ln
from app.bitnob.client import BitnobClient
from app.config import get_settings
from app.deps import get_client, require_api_key
from app.schemas import InvoiceIn

router = APIRouter(prefix="/invoices", tags=["invoices"], dependencies=[Depends(require_api_key)])


def _qr(request: str):
    # Préfixe lightning: : les portefeuilles ouvrent directement l'écran de paiement
    return segno.make(f"lightning:{request}", error="l")


@router.post("", status_code=201)
async def create_invoice(body: InvoiceIn, c: BitnobClient = Depends(get_client)):
    customer_id = body.customer_id or get_settings().bitnob_customer_id or None
    inv = await ln.create_invoice(
        c, amount_sat=body.amount_sat, description=body.description,
        reference=body.reference, expiry_seconds=body.expiry_seconds,
        customer_id=customer_id,
    )
    qr = _qr(inv["request"])
    return {**inv, "qr_svg_data_uri": qr.svg_data_uri(scale=6), "qr_png_data_uri": qr.png_data_uri(scale=6)}


@router.get("")
async def list_invoices(status: str | None = None, direction: str = "incoming",
                        page: int = 1, page_size: int = 20,
                        c: BitnobClient = Depends(get_client)):
    return await ln.list_invoices(c, status=status, direction=direction, page=page, page_size=page_size)


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str, c: BitnobClient = Depends(get_client)):
    """À interroger (polling) : status 'paid' + preimage = paiement reçu."""
    return await ln.get_invoice(c, invoice_id)


@router.get("/{invoice_id}/qr.svg")
async def invoice_qr(invoice_id: str, c: BitnobClient = Depends(get_client)):
    inv = await ln.get_invoice(c, invoice_id)
    buf = io.BytesIO()
    _qr(inv["request"]).save(buf, kind="svg", scale=6)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")


@router.post("/{invoice_id}/simulate-paid")
async def simulate_paid(invoice_id: str, c: BitnobClient = Depends(get_client)):
    """MODE SIMULÉ : marque la facture comme payée (comme si le client avait scanné le QR)."""
    if not getattr(c, "mock", False):
        raise HTTPException(404, "Disponible uniquement avec BITNOB_MOCK=true.")
    inv = c.mark_invoice_paid(invoice_id)
    return c._inv_view(inv)
