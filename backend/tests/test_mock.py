"""Parcours complets en MODE SIMULÉ (aucun appel réseau, aucun faux transport httpx)."""
import os
import time

import pytest

os.environ.update(BITNOB_CLIENT_ID="client_123", BITNOB_CLIENT_SECRET="secret_456", APP_API_KEY="k")

from fastapi.testclient import TestClient  # noqa: E402

from app.bitnob.mock import MockBitnobClient  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.repo import get_repo  # noqa: E402
from app.services import bulk  # noqa: E402
from app.services import envelopes as env_svc  # noqa: E402

AUTH = {"X-API-Key": "k"}
CSV = """name,account_number,bank_code,amount,currency,country
Kwame,0241230001,MTN,50,GHS,GH
Ama,0201230002,VOD,75.5,GHS,GH
Rejeté,0241230000,MTN,20,GHS,GH
Expiré,0241239999,MTN,30,GHS,GH
Perdu,0241235000,MTN,40,GHS,GH
"""


def make_ctx(balance=1000.0):
    s = get_settings().model_copy(update={"mock_delay_seconds": 0.0, "mock_balance_usd": balance,
                                          "bitnob_mock": True})
    env_svc.ENVELOPES.clear(); env_svc.ALERTS.clear(); env_svc.SEEN_EVENTS.clear(); env_svc.KYC_CUSTOMERS.clear()
    get_repo().clear(); bulk._RUNNING.clear(); bulk._COUNTRY_CACHE.update(ts=0.0, codes=None)
    return MockBitnobClient(s)


@pytest.fixture
def tc():
    with TestClient(app) as c:
        app.state.bitnob = make_ctx()
        yield c


def wait_for(fn, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.03)
    raise AssertionError("délai dépassé")


def test_health_reports_mock_mode(tc):
    assert tc.get("/health").json() == {
        "status": "ok", "mode": "mock", "demo": True, "db": False
    }
    assert tc.get("/whoami", headers=AUTH).json()["data"]["environment"] == "mock"


def test_full_bulk_flow_with_all_outcomes(tc):
    rec = tc.post("/batches", files={"file": ("b.csv", CSV.encode())}, data={"name": "Demo"}, headers=AUTH).json()
    bid = rec["batch"]["id"]
    assert rec["beneficiaries_count"] == 5 and rec["rejected_count"] == 0
    assert tc.post(f"/batches/{bid}/execute", headers=AUTH).status_code == 202

    def status():
        det = tc.get(f"/batches/{bid}", headers=AUTH).json()
        return {p["name"]: p["status"] for p in det["payouts"]}

    # les webhooks simulés font avancer les statuts tout seuls
    wait_for(lambda: status()["Kwame"] == "SUCCESS" and status()["Expiré"] == "EXPIRED")
    st = status()
    assert st["Ama"] == "SUCCESS" and st["Rejeté"] == "FAILED" and st["Perdu"] == "UNCERTAIN"

    # le webhook du paiement « perdu » n'arrive jamais : refresh va interroger le faux Bitnob
    wait_for(lambda: tc.post(f"/batches/{bid}/refresh", headers=AUTH).json()["updated"] == 1)
    assert status()["Perdu"] == "SUCCESS"

    det = tc.get(f"/batches/{bid}", headers=AUTH).json()
    assert det["batch"]["status"] == "PARTIAL"
    assert all(p["fee"] for p in det["payouts"] if p["status"] == "SUCCESS")

    s = tc.get("/dashboard/summary", headers=AUTH).json()
    assert s["totals"]["success"] == 3 and s["totals"]["failed"] == 2
    bal = {b["currency"]: float(b["available"]) for b in tc.get("/balances", headers=AUTH).json()["data"]}
    assert bal["USDT"] < 1000        # les payouts réussis ont débité le wallet


def test_envelope_lifecycle_alert_freeze_recharge(tc):
    r = tc.post("/envelopes", json={"name": "Meta Ads", "monthly_budget_usd": "30",
                                    "customer_id": "cust-1"}, headers=AUTH)
    assert r.status_code == 201, r.text
    cid = r.json()["card_id"]
    wait_for(lambda: tc.get(f"/envelopes/{cid}", headers=AUTH).json()["status"] == "active")
    env = tc.get(f"/envelopes/{cid}", headers=AUTH).json()
    assert env["balance_usd"] == 30 and env["last4"] and "masked_pan" not in env
    bal = {b["currency"]: float(b["available"]) for b in tc.get("/balances", headers=AUTH).json()["data"]}
    assert bal["USDC"] == 968        # 30 de budget + 2 de frais de création

    def alerts():
        return tc.get("/alerts", headers=AUTH).json()

    tc.post(f"/cards/{cid}/simulate/settlement", params={"amount_usd": 25}, headers=AUTH)
    wait_for(lambda: any(a["level"] == "warning" for a in alerts()))
    tc.post(f"/cards/{cid}/simulate/settlement", params={"amount_usd": 5}, headers=AUTH)
    wait_for(lambda: tc.get(f"/envelopes/{cid}", headers=AUTH).json()["status"] == "frozen")
    assert any(a["level"] == "critical" for a in alerts())

    tc.post(f"/cards/{cid}/simulate/settlement", headers=AUTH)      # carte gelée -> refus
    wait_for(lambda: any("refusé" in a["message"] for a in alerts()))

    assert tc.post(f"/envelopes/{cid}/recharge", headers=AUTH).json()["funded_usd"] == 30
    wait_for(lambda: tc.get(f"/envelopes/{cid}", headers=AUTH).json()["status"] == "active")
    assert tc.get(f"/envelopes/{cid}", headers=AUTH).json()["balance_usd"] == 30
    assert len(tc.get(f"/envelopes/{cid}/transactions", headers=AUTH).json()["data"]["transactions"]) >= 3


def test_insufficient_balance_error_matches_real_bitnob():
    with TestClient(app) as c:
        app.state.bitnob = make_ctx(balance=10.0)
        r = c.post("/envelopes", json={"name": "X", "monthly_budget_usd": "30", "customer_id": "c"}, headers=AUTH)
        assert r.status_code == 400
        assert r.json()["details"]["extensions"]["error_code"] == "COMPANY_INSUFFICIENT_BALANCE"
        # le « faucet » de démo règle le problème
        c.post("/mock/credit", json={"currency": "USDC", "amount": 100}, headers=AUTH)
        assert c.post("/envelopes", json={"name": "X", "monthly_budget_usd": "30", "customer_id": "c"},
                      headers=AUTH).status_code == 201


def test_kyc_and_invoice_flow(tc):
    kyc = tc.post("/cards/kyc", headers=AUTH, json={
        "customer": {"first_name": "Awa", "last_name": "Diop", "email": "awa@x.sn", "date_of_birth": "1995-04-23",
                     "line1": "Rue 10", "city": "Dakar", "state": "Dakar", "postal_code": "10000",
                     "country": "SN"},
        "id_type": "passport", "id_number": "A1234567"}).json()
    assert kyc["data"]["status"] == "approved"

    inv = tc.post("/invoices", json={"amount_sat": 10000, "description": "Facture #1"}, headers=AUTH).json()
    assert inv["status"] == "pending" and inv["qr_svg_data_uri"].startswith("data:image/svg+xml")
    assert tc.get(f"/invoices/{inv['id']}", headers=AUTH).json()["status"] == "pending"
    assert tc.post(f"/invoices/{inv['id']}/simulate-paid", headers=AUTH).json()["status"] == "paid"
    got = tc.get(f"/invoices/{inv['id']}", headers=AUTH).json()
    assert got["status"] == "paid" and got["preimage"]


def test_reset_clears_everything(tc):
    tc.post("/batches/manual", headers=AUTH, json={"beneficiaries": [
        {"name": "A", "account_number": "0241230001", "bank_code": "MTN", "country": "GH",
         "amount": "5", "currency": "GHS"}]})
    assert tc.get("/batches", headers=AUTH).json()
    assert tc.post("/mock/reset", headers=AUTH).json() == {"status": "reset"}
    assert tc.get("/batches", headers=AUTH).json() == []
