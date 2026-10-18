"""Entités métier des paiements de masse (indépendantes du stockage)."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

PayoutStatus = Literal["PENDING", "QUOTED", "INITIATED", "SUBMITTED", "PROCESSING",
                       "SUCCESS", "FAILED", "EXPIRED", "UNCERTAIN"]
BatchStatus = Literal["DRAFT", "VALIDATED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]

TERMINAL = {"SUCCESS", "FAILED", "EXPIRED"}
TERMINAL_BATCHES = {"COMPLETED", "PARTIAL", "FAILED", "CANCELLED"}
IN_FLIGHT = {"PENDING", "QUOTED", "INITIATED", "SUBMITTED", "PROCESSING", "UNCERTAIN"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class Payout(BaseModel):
    id: str = Field(default_factory=new_id)
    batch_id: str
    line: int                              # ligne du CSV
    reference: str                         # référence envoyée à Bitnob (unique)
    attempts: int = 0
    name: str
    account_number: str
    bank_code: str | None = None
    destination_type: str = "mobile_money"
    country: str                           # ISO alpha-2
    amount: Decimal                        # montant reçu par le bénéficiaire
    currency: str                          # devise reçue (ex. GHS)
    status: PayoutStatus = "PENDING"
    quote_id: str | None = None
    bitnob_payout_id: str | None = None
    quote: dict[str, Any] | None = None    # réponse brute de Bitnob
    fee: Decimal | None = None
    error: str | None = None
    error_stage: str | None = None         # quote | initialize | finalize
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    completed_at: datetime | None = None


class Batch(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    status: BatchStatus = "DRAFT"
    from_asset: str = "USDT"               # actif débité sur le solde Bitnob
    payment_reason: str = "vendor_payment"
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    executed_at: datetime | None = None
