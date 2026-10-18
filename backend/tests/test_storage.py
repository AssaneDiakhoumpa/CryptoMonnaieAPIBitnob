from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.repo.supabase import SupabaseRepo


def test_amounts_are_converted_to_integer_minor_units():
    assert SupabaseRepo._to_minor(Decimal("75.50"), 2) == 7550
    with pytest.raises(ValueError, match="décimales"):
        SupabaseRepo._to_minor(Decimal("75.501"), 2)


def test_database_attempt_maps_to_backend_payout():
    created_at = datetime.now(timezone.utc)
    row = {
        "id": uuid4(),
        "batch_id": uuid4(),
        "line_reference": "legacy-reference",
        "line_order": 3,
        "settlement_minor": 7550,
        "settlement_currency": "GHS",
        "line_status": "pending",
        "created_at": created_at,
        "updated_at": created_at,
        "line_completed_at": None,
        "payment_reason": "vendor_payment",
        "source_asset": "USDT",
        "full_name": "Awa",
        "account_number": "0241234567",
        "phone_e164": None,
        "bank_code": "MTN",
        "destination_type": "mobile_money",
        "country": "GH",
        "exponent": 2,
        "attempt_reference": "legacy-reference-R2",
        "attempt_status": "pending",
        "bitnob_quote_id": "quote-2",
        "bitnob_payout_id": "payout-2",
        "fee_source_minor": None,
        "failure_reason": "finalize: Finalisation à vérifier",
        "raw_last_response": None,
        "attempt_created_at": created_at,
        "attempt_updated_at": created_at,
        "attempt_completed_at": None,
        "attempt_count": 2,
    }

    payout = SupabaseRepo._payout_from_row(row)

    assert payout.line == 3
    assert payout.amount == Decimal("75.5")
    assert payout.reference == "legacy-reference-R2"
    assert payout.attempts == 1
    assert payout.status == "UNCERTAIN"
    assert payout.error_stage == "finalize"
    assert payout.error == "Finalisation à vérifier"
