"""Tests hors-ligne des paiements de masse (API Bitnob simulée)."""
import hashlib
import hmac
import json
import os

import httpx
import pytest

CID, SECRET = "client_123", "secret_456"
os.environ.update(BITNOB_CLIENT_ID=CID, BITNOB_CLIENT_SECRET=SECRET, APP_API_KEY="k",
                  PUBLIC_BASE_URL="https://example.ngrok.app")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.repo import get_repo  # noqa: E402
from app.services import bulk  # noqa: E402

AUTH = {"X-API-Key": "k"}
CSV = """name,account_number,bank_code,amount,currency,country
Kwame,0241234567,MTN,50,GHS,GH
Ama,0201234567,VOD,"75,5",GHS,GH
Chidi,08012345678,MTN,10000,NGN,NG
Fail Guy,0241111111,MTN,20,GHS,GH
Bad,abc,MTN,-5,GHS,GH
Dup,0241234567,MTN,50,GHS,GH
Zed,123456,X,5,USD,ZZ
"""


class FakeBitnob:
    def __init__(self):
        self.n = 0
        self.accounts = {}          # quote_id -> compte
        self.finalize_500 = set()   # comptes dont finalize renvoie 500
        self.calls = []
        self.payout_status = {}     # payout_id -> status pour GET

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = request.content.decode()
        h = request.headers
        exp = hmac.new(SECRET.encode(), f"{CID}:{h['x-auth-timestamp']}:{h['x-auth-nonce']}:{body}".encode(),
                       hashlib.sha256).hexdigest()
        assert h["x-auth-signature"] == exp
        data = json.loads(body) if body else None
        m, path = request.method, request.url.path
        self.calls.append((m, path, data))

        if path == "/api/payouts/supported-countries":
            return httpx.Response(200, json={"success": True, "data": [{"country": "GH"}, {"country": "NG"}]})
        if (m, path) == ("POST", "/api/payouts/quotes"):
            self.n += 1
            return httpx.Response(200, json={"success": True, "data": {"payout": {
                "quote_id": f"q{self.n}", "fee": "0.5"}}})
        if path.endswith("/initialize"):
            qid = path.split("/")[3]
            self.accounts[qid] = data["beneficiary"]["account_number"]
            return httpx.Response(200, json={"success": True, "data": {"payout": {
                "id": f"p-{qid}", "status": "INITIATED"}}})
        if path.endswith("/finalize"):
            qid = path.split("/")[3]
            acc = self.accounts[qid]
            if acc == "0241111111":
                return httpx.Response(400, json={"success": False, "error": {
                    "code": "BAD_REQUEST", "message": "Beneficiary account rejected"}})
            if acc in self.finalize_500:
                return httpx.Response(500, json={"success": False, "message": "boom"})
            return httpx.Response(200, json={"success": True, "data": {"payout": {
                "id": f"p-{qid}", "status": "PENDING"}}})
        if m == "GET" and path.startswith("/api/payouts/p-"):
            pid = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={"success": True, "data": {"payout": {
                "id": pid, "status": self.payout_status.get(pid, "PENDING")}}})
        return httpx.Response(404, json={"success": False, "message": f"no mock {m} {path}"})


@pytest.fixture
def ctx(monkeypatch):
    monkeypatch.setattr(get_settings(), "confirm_payout", True)
    get_repo().clear()
    bulk._COUNTRY_CACHE.update(ts=0.0, codes=None)
    bulk._RUNNING.clear()
    bulk.BACKOFF = 0
    fake = FakeBitnob()
    with TestClient(app) as tc:
        app.state.bitnob._http = httpx.AsyncClient(
            base_url="https://api.bitnob.com", transport=httpx.MockTransport(fake))
        yield tc, fake


def upload(tc, text=CSV, **form):
    return tc.post("/batches", files={"file": ("b.csv", text.encode(), "text/csv")},
                   data={"name": "Livreurs", **form}, headers=AUTH)


def test_execute_requires_live_payout_confirmation(ctx, monkeypatch):
    tc, _ = ctx
    monkeypatch.setattr(get_settings(), "confirm_payout", False)
    bid = upload(tc).json()["batch"]["id"]
    assert tc.post(f"/batches/{bid}/execute", headers=AUTH).status_code == 403


def hook(tc, event, ref, eid):
    raw = json.dumps({"event": event, "eventId": eid, "data": {"reference": ref}}).encode()
    sig = hmac.new(SECRET.encode(), raw, hashlib.sha512).hexdigest()
    return tc.post("/webhooks/bitnob", content=raw, headers={"x-bitnob-signature": sig})


def test_upload_validates_and_summarises(ctx):
    tc, _ = ctx
    r = upload(tc)
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["beneficiaries_count"] == 4 and rec["rejected_count"] == 3
    assert rec["totals_by_currency"] == {"GHS": "145.5", "NGN": "10000"}
    assert rec["countries"] == {"GH": 3, "NG": 1}
    reasons = {x["line"]: " ".join(x["errors"]) for x in rec["rejected_rows"]}
    assert "invalide" in reasons[6] and "doublon" in reasons[7] and "non supporté" in reasons[8]
    assert rec["batch"]["status"] == "DRAFT"


def test_strict_refuses_whole_file(ctx):
    tc, _ = ctx
    r = upload(tc, strict="true")
    assert r.status_code == 422 and len(r.json()["detail"]["rejected_rows"]) == 3


def test_semicolon_csv_and_french_headers(ctx):
    tc, _ = ctx
    r = upload(tc, "nom;compte;operateur;montant;devise;pays\nAwa;0241234567;MTN;12,5;GHS;GH\n")
    assert r.status_code == 201 and r.json()["beneficiaries_count"] == 1


def test_missing_columns_is_clear(ctx):
    tc, _ = ctx
    r = upload(tc, "name,amount\nA,5\n")
    assert r.status_code == 422 and "Colonnes manquantes" in r.json()["detail"]


def test_execute_track_webhook_retry_and_report(ctx):
    tc, fake = ctx
    bid = upload(tc).json()["batch"]["id"]

    assert tc.post(f"/batches/{bid}/execute", headers=AUTH).status_code == 202
    assert tc.post(f"/batches/{bid}/execute", headers=AUTH).status_code == 409   # pas de double paiement

    det = tc.get(f"/batches/{bid}", headers=AUTH).json()
    by_name = {p["name"]: p for p in det["payouts"]}
    assert by_name["Kwame"]["status"] == "SUBMITTED" and by_name["Kwame"]["fee"] == "0.5"
    assert by_name["Fail Guy"]["status"] == "FAILED" and "rejected" in by_name["Fail Guy"]["error"]
    assert by_name["Fail Guy"]["error_stage"] == "finalize"
    assert det["batch"]["status"] == "RUNNING"

    # webhooks : 3 livrés -> batch PARTIAL
    for i, n in enumerate(["Kwame", "Ama", "Chidi"]):
        assert hook(tc, "payouts.withdrawal.success", by_name[n]["reference"], f"e{i}").status_code == 200
    det = tc.get(f"/batches/{bid}", headers=AUTH).json()
    assert det["payouts_by_status"] == {"SUCCESS": 3, "FAILED": 1}
    assert det["batch"]["status"] == "PARTIAL"

    # rapport CSV
    rep = tc.get(f"/batches/{bid}/report.csv", headers=AUTH)
    assert rep.headers["content-type"].startswith("text/csv") and "Fail Guy" in rep.text

    # dashboard
    s = tc.get("/dashboard/summary", headers=AUTH).json()
    assert s["totals"]["success"] == 3 and s["totals"]["failed"] == 1 and s["totals"]["success_rate"] == 0.75
    assert s["volume_by_currency"]["GHS"]["sent"] == "125.5"

    # relance : nouvelle référence, le compte fautif échoue encore (mock) mais ne touche pas les autres
    n_before = len([c for c in fake.calls if c[1].endswith("/finalize")])
    assert tc.post(f"/batches/{bid}/retry", headers=AUTH).json()["retried"] == 1
    assert len([c for c in fake.calls if c[1].endswith("/finalize")]) == n_before + 1
    p = [x for x in tc.get(f"/batches/{bid}", headers=AUTH).json()["payouts"] if x["name"] == "Fail Guy"][0]
    assert p["attempts"] == 1 and p["reference"].endswith("-r1")


def test_ambiguous_finalize_is_uncertain_never_retried(ctx):
    tc, fake = ctx
    fake.finalize_500.add("0241234567")
    bid = upload(tc, "name,account_number,bank_code,amount,currency,country\nKwame,0241234567,MTN,50,GHS,GH\n").json()["batch"]["id"]
    tc.post(f"/batches/{bid}/execute", headers=AUTH)
    p = tc.get(f"/batches/{bid}", headers=AUTH).json()["payouts"][0]
    assert p["status"] == "UNCERTAIN"
    n = len(fake.calls)
    assert tc.post(f"/batches/{bid}/retry", headers=AUTH).json()["retried"] == 0
    assert len(fake.calls) == n                                   # aucun nouvel appel Bitnob

    fake.payout_status[p["bitnob_payout_id"]] = "COMPLETED"       # vérification manuelle
    r = tc.post(f"/batches/{bid}/refresh", headers=AUTH).json()
    assert r["updated"] == 1
    assert tc.get(f"/batches/{bid}", headers=AUTH).json()["batch"]["status"] == "COMPLETED"


def test_manual_batch_json(ctx):
    tc, _ = ctx
    r = tc.post("/batches/manual", headers=AUTH, json={"beneficiaries": [
        {"name": "Awa", "account_number": "0241234567", "bank_code": "MTN",
         "country": "GH", "amount": "12.5", "currency": "GHS"}]})
    assert r.status_code == 201 and r.json()["totals_by_currency"] == {"GHS": "12.5"}
