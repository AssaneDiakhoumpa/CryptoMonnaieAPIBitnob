"""Repository PostgreSQL pour le schéma BulkPay ERP."""
import json
import re
import uuid
from decimal import Decimal
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings
from app.domain import Batch, Payout, TERMINAL_BATCHES, now
from app.repo.base import RepositoryConfigurationError

_BATCH_TO_DB = {
    "DRAFT": "draft",
    "VALIDATED": "validated",
    "RUNNING": "running",
    "COMPLETED": "completed",
    "PARTIAL": "partial",
    "FAILED": "failed",
    "CANCELLED": "cancelled",
}
_PAYOUT_TO_DB = {
    "INITIATED": "initialized",
    "SUBMITTED": "pending",
    "PROCESSING": "pending",
    "SUCCESS": "completed",
    "FAILED": "failed",
    "EXPIRED": "expired",
}
_DB_TO_PAYOUT = {
    "quoted": "PENDING",
    "initialized": "INITIATED",
    "pending": "SUBMITTED",
    "completed": "SUCCESS",
    "failed": "FAILED",
    "expired": "EXPIRED",
}


class SupabaseRepo:
    def __init__(self, database_url: str) -> None:
        self._pool = AsyncConnectionPool(
            database_url,
            min_size=1,
            max_size=10,
            open=False,
            kwargs={"row_factory": dict_row},
        )

    async def open(self) -> None:
        await self._pool.open(wait=True)

    async def close(self) -> None:
        await self._pool.close()

    async def check_connection(self) -> bool:
        async with self._pool.connection() as conn:
            row = await (await conn.execute("SELECT 1 AS connected")).fetchone()
        return row["connected"] == 1

    async def _owner_id(self, conn) -> uuid.UUID:
        rows = await (await conn.execute(
            "SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE"
        )).fetchall()
        if len(rows) != 1:
            raise RepositoryConfigurationError(
                "La base doit contenir exactement un administrateur actif "
                "pour le backend à clé API."
            )
        return rows[0]["id"]

    async def create_batch(self, batch: Batch, payouts: list[Payout]) -> None:
        async with self._pool.connection() as conn:
            async with conn.transaction():
                owner_id = await self._owner_id(conn)
                simulated = get_settings().bitnob_mock
                batch_beneficiaries: set[uuid.UUID] = set()
                await conn.execute(
                    """INSERT INTO batches
                       (id, owner_id, name, source_asset, status, is_simulated, created_at)
                       VALUES (%s, %s, %s, %s, 'draft', %s, %s)""",
                    (uuid.UUID(batch.id), owner_id, batch.name, batch.from_asset,
                     simulated, batch.created_at),
                )
                for payout in payouts:
                    currency = await (await conn.execute(
                        "SELECT exponent FROM currencies WHERE code = %s",
                        (payout.currency.upper(),),
                    )).fetchone()
                    if currency is None:
                        raise ValueError(f"Devise inconnue dans la base : {payout.currency}")
                    amount_minor = self._to_minor(payout.amount, currency["exponent"])
                    beneficiary = await (await conn.execute(
                        """SELECT id FROM beneficiaries
                           WHERE owner_id = %s AND country = %s AND currency = %s
                             AND destination_type = %s
                             AND account_number IS NOT DISTINCT FROM %s
                           ORDER BY created_at LIMIT 1""",
                        (owner_id, payout.country, payout.currency.upper(),
                         payout.destination_type, payout.account_number),
                    )).fetchone()
                    if beneficiary is None:
                        beneficiary = await (await conn.execute(
                            """INSERT INTO beneficiaries
                               (owner_id, full_name, country, currency, destination_type,
                                account_number, bank_code, is_simulated)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                               RETURNING id""",
                            (owner_id, payout.name, payout.country, payout.currency.upper(),
                             payout.destination_type, payout.account_number, payout.bank_code,
                             simulated),
                        )).fetchone()
                    if beneficiary["id"] in batch_beneficiaries:
                        raise ValueError(
                            "La base n'autorise qu'une ligne par bénéficiaire dans un lot."
                        )
                    batch_beneficiaries.add(beneficiary["id"])
                    await conn.execute(
                        """INSERT INTO payouts
                           (id, batch_id, beneficiary_id, reference, settlement_minor,
                            settlement_currency, source_asset, payment_reason, status, is_simulated)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'quoted', %s)""",
                        (uuid.UUID(payout.id), uuid.UUID(batch.id), beneficiary["id"],
                         payout.reference, amount_minor, payout.currency.upper(),
                         batch.from_asset, batch.payment_reason, simulated),
                    )
                await conn.execute(
                    """INSERT INTO audit_log
                       (user_id, action, entity, entity_id, details, is_simulated)
                       VALUES (%s, 'batch_created', 'batches', %s, %s, %s)""",
                    (owner_id, batch.id, Jsonb({"payouts": len(payouts)}), simulated),
                )

    @staticmethod
    def _to_minor(amount: Decimal, exponent: int) -> int:
        scaled = amount * (Decimal(10) ** exponent)
        if not amount.is_finite() or scaled != scaled.to_integral_value():
            raise ValueError("Le montant comporte plus de décimales que la devise autorisée.")
        return int(scaled)

    async def get_batch(self, batch_id: str) -> Batch | None:
        async with self._pool.connection() as conn:
            owner_id = await self._owner_id(conn)
            row = await (await conn.execute(
                """SELECT b.*,
                          COALESCE((SELECT p.payment_reason FROM payouts p
                                    WHERE p.batch_id = b.id ORDER BY p.reference LIMIT 1),
                                   'vendor_payment') AS payment_reason
                   FROM batches b WHERE b.id = %s AND b.owner_id = %s""",
                (uuid.UUID(batch_id), owner_id),
            )).fetchone()
        return self._batch_from_row(row) if row else None

    async def list_batches(self) -> list[Batch]:
        async with self._pool.connection() as conn:
            owner_id = await self._owner_id(conn)
            rows = await (await conn.execute(
                """SELECT b.*,
                          COALESCE((SELECT p.payment_reason FROM payouts p
                                    WHERE p.batch_id = b.id ORDER BY p.reference LIMIT 1),
                                   'vendor_payment') AS payment_reason
                   FROM batches b WHERE b.owner_id = %s ORDER BY b.created_at DESC""",
                (owner_id,),
            )).fetchall()
        return [self._batch_from_row(row) for row in rows]

    @staticmethod
    def _batch_from_row(row: dict[str, Any]) -> Batch:
        executed_at = row["launched_at"]
        updated_at = row["finished_at"] or executed_at or row["created_at"]
        return Batch(
            id=str(row["id"]),
            name=row["name"],
            status=row["status"].upper(),
            from_asset=row["source_asset"],
            payment_reason=row["payment_reason"],
            created_at=row["created_at"],
            updated_at=updated_at,
            executed_at=executed_at,
        )

    async def save_batch(self, batch: Batch) -> None:
        if batch.status not in _BATCH_TO_DB:
            raise ValueError(f"Statut de lot non pris en charge : {batch.status}")
        finished_at = now() if batch.status in TERMINAL_BATCHES else None
        async with self._pool.connection() as conn:
            async with conn.transaction():
                owner_id = await self._owner_id(conn)
                batch_row = await (await conn.execute(
                    """SELECT owner_id, status FROM batches
                       WHERE id = %s AND owner_id = %s FOR UPDATE""",
                    (uuid.UUID(batch.id), owner_id),
                )).fetchone()
                if batch_row is None:
                    raise LookupError("Batch introuvable dans la base.")
                await conn.execute(
                    """UPDATE batches
                       SET status = %s,
                           launched_at = COALESCE(launched_at, %s),
                           launched_by = COALESCE(launched_by, %s),
                           finished_at = CASE WHEN %s = 'running' THEN NULL
                                              ELSE COALESCE(%s, finished_at) END
                       WHERE id = %s AND owner_id = %s""",
                    (_BATCH_TO_DB[batch.status], batch.executed_at, batch_row["owner_id"],
                     _BATCH_TO_DB[batch.status], finished_at, uuid.UUID(batch.id), owner_id),
                )
                if batch.status == "RUNNING" and batch_row["status"] in {"draft", "validated"}:
                    await conn.execute(
                        """INSERT INTO audit_log
                           (user_id, action, entity, entity_id, details, is_simulated)
                           VALUES (%s, 'batch_launched', 'batches', %s, %s, %s)""",
                        (batch_row["owner_id"], batch.id, Jsonb({}),
                         get_settings().bitnob_mock),
                    )
        batch.updated_at = now()

    async def get_payout(self, payout_id: str) -> Payout | None:
        async with self._pool.connection() as conn:
            owner_id = await self._owner_id(conn)
            row = await (await conn.execute(
                self._payout_query()
                + " WHERE p.id = %s AND b.owner_id = %s AND (bt.owner_id = %s OR p.batch_id IS NULL)",
                (uuid.UUID(payout_id), owner_id, owner_id),
            )).fetchone()
        return self._payout_from_row(row) if row else None

    async def list_payouts(self, batch_id: str | None = None) -> list[Payout]:
        query = self._payout_query()
        params: tuple
        async with self._pool.connection() as conn:
            owner_id = await self._owner_id(conn)
            params = (owner_id, owner_id)
            query += " WHERE b.owner_id = %s AND (bt.owner_id = %s OR p.batch_id IS NULL)"
            if batch_id is not None:
                query += " AND p.batch_id = %s"
                params += (uuid.UUID(batch_id),)
            query += " ORDER BY p.reference"
            rows = await (await conn.execute(query, params)).fetchall()
        return [self._payout_from_row(row) for row in rows]

    @staticmethod
    def _payout_query() -> str:
        return """SELECT p.id, p.batch_id, p.reference AS line_reference,
                         row_number() OVER (PARTITION BY p.batch_id ORDER BY p.reference) AS line_order,
                         p.settlement_minor, p.settlement_currency, p.status AS line_status,
                         p.created_at, p.updated_at, p.completed_at AS line_completed_at,
                         p.payment_reason, p.source_asset, b.full_name, b.account_number,
                         b.phone_e164, b.bank_code, b.destination_type, b.country,
                         c.exponent,
                         a.reference AS attempt_reference, a.status AS attempt_status,
                         a.bitnob_quote_id, a.bitnob_payout_id, a.fee_source_minor,
                         a.failure_reason, a.raw_last_response, a.created_at AS attempt_created_at,
                         a.updated_at AS attempt_updated_at, a.completed_at AS attempt_completed_at,
                         (SELECT COUNT(*) FROM payout_attempts ac WHERE ac.payout_id = p.id) AS attempt_count
                  FROM payouts p
                  JOIN beneficiaries b ON b.id = p.beneficiary_id
                  JOIN currencies c ON c.code = p.settlement_currency
                  LEFT JOIN batches bt ON bt.id = p.batch_id
                  LEFT JOIN LATERAL (
                      SELECT pa.* FROM payout_attempts pa
                      WHERE pa.payout_id = p.id ORDER BY pa.attempt_no DESC LIMIT 1
                  ) a ON TRUE"""

    @staticmethod
    def _payout_from_row(row: dict[str, Any]) -> Payout:
        line_reference = row["line_reference"]
        line_match = re.search(r"-(\d+)$", line_reference)
        attempt_status = row["attempt_status"] or row["line_status"]
        status = _DB_TO_PAYOUT[attempt_status]
        failure_reason = row["failure_reason"]
        if failure_reason and attempt_status in {"initialized", "pending"}:
            status = "UNCERTAIN"
        raw_quote = row["raw_last_response"]
        if isinstance(raw_quote, str):
            raw_quote = json.loads(raw_quote)
        fee = None
        if isinstance(raw_quote, dict):
            for key in ("fee", "fees", "total_fee", "fee_amount"):
                if raw_quote.get(key) is not None:
                    fee = Decimal(str(raw_quote[key]))
                    break
        error_stage = None
        error = failure_reason
        for stage in ("quote", "initialize", "finalize"):
            prefix = f"{stage}: "
            if failure_reason and failure_reason.startswith(prefix):
                error_stage, error = stage, failure_reason[len(prefix):]
                break
        return Payout(
            id=str(row["id"]),
            batch_id=str(row["batch_id"]),
            line=int(line_match.group(1)) if line_match else row["line_order"],
            reference=row["attempt_reference"] or line_reference,
            attempts=max(row["attempt_count"] - 1, 0),
            name=row["full_name"],
            account_number=row["account_number"] or row["phone_e164"] or "",
            bank_code=row["bank_code"],
            destination_type=row["destination_type"],
            country=row["country"],
            amount=Decimal(row["settlement_minor"]) / (Decimal(10) ** row["exponent"]),
            currency=row["settlement_currency"],
            status=status,
            quote_id=row["bitnob_quote_id"],
            bitnob_payout_id=row["bitnob_payout_id"],
            quote=raw_quote,
            fee=fee,
            error=error,
            error_stage=error_stage,
            created_at=row["created_at"],
            updated_at=row["attempt_updated_at"] or row["updated_at"],
            completed_at=row["attempt_completed_at"] or row["line_completed_at"],
        )

    async def save_payout(self, payout: Payout) -> None:
        if payout.quote is None and payout.quote_id is None and payout.bitnob_payout_id is None:
            payout.updated_at = now()
            return
        async with self._pool.connection() as conn:
            async with conn.transaction():
                owner_id = await self._owner_id(conn)
                attempt = await (await conn.execute(
                    """SELECT pa.id FROM payout_attempts pa
                       JOIN payouts p ON p.id = pa.payout_id
                       JOIN beneficiaries ben ON ben.id = p.beneficiary_id
                       LEFT JOIN batches bt ON bt.id = p.batch_id
                       WHERE pa.payout_id = %s AND ben.owner_id = %s
                         AND (bt.owner_id = %s OR p.batch_id IS NULL)
                       ORDER BY pa.attempt_no DESC LIMIT 1 FOR UPDATE OF pa""",
                    (uuid.UUID(payout.id), owner_id, owner_id),
                )).fetchone()
                if attempt is None:
                    raise RuntimeError("Aucun essai de paiement ouvert pour cette ligne.")
                await conn.execute(
                    """UPDATE payout_attempts
                       SET bitnob_quote_id = COALESCE(%s, bitnob_quote_id),
                           bitnob_payout_id = COALESCE(%s, bitnob_payout_id),
                           raw_last_response = COALESCE(%s, raw_last_response)
                       WHERE id = %s""",
                    (payout.quote_id, payout.bitnob_payout_id,
                     Jsonb(payout.quote) if payout.quote is not None else None,
                     attempt["id"]),
                )
        payout.updated_at = now()

    async def start_payout_attempt(self, payout_id: str) -> str:
        async with self._pool.connection() as conn:
            async with conn.transaction():
                owner_id = await self._owner_id(conn)
                line = await (await conn.execute(
                    """SELECT p.reference, p.batch_id, b.owner_id, ben.owner_id AS beneficiary_owner_id
                       FROM payouts p
                       JOIN beneficiaries ben ON ben.id = p.beneficiary_id
                       LEFT JOIN batches b ON b.id = p.batch_id
                       WHERE p.id = %s AND ben.owner_id = %s
                         AND COALESCE(b.owner_id, ben.owner_id) = %s""",
                    (uuid.UUID(payout_id), owner_id, owner_id),
                )).fetchone()
                if line is None:
                    raise LookupError("Paiement introuvable dans la base.")
                current = await (await conn.execute(
                    """SELECT reference, attempt_no, status FROM payout_attempts
                       WHERE payout_id = %s ORDER BY attempt_no DESC LIMIT 1""",
                    (uuid.UUID(payout_id),),
                )).fetchone()
                row = await (await conn.execute(
                    "SELECT start_payout_attempt(%s) AS reference",
                    (uuid.UUID(payout_id),),
                )).fetchone()
                if current:
                    await conn.execute(
                        """INSERT INTO audit_log
                           (user_id, action, entity, entity_id, details, is_simulated)
                           VALUES (%s, 'payout_retried', 'payouts', %s, %s, %s)""",
                        (line["owner_id"] or line["beneficiary_owner_id"], payout_id,
                         Jsonb({"reference": row["reference"]}), get_settings().bitnob_mock),
                    )
        return row["reference"]

    async def apply_payout_status(self, payout: Payout, *, origin: str,
                                  event_id: str | None = None) -> bool:
        db_status = _PAYOUT_TO_DB.get(payout.status)
        async with self._pool.connection() as conn:
            async with conn.transaction():
                owner_id = await self._owner_id(conn)
                attempt = await (await conn.execute(
                    """SELECT pa.reference FROM payout_attempts pa
                       JOIN payouts p ON p.id = pa.payout_id
                       JOIN beneficiaries ben ON ben.id = p.beneficiary_id
                       LEFT JOIN batches bt ON bt.id = p.batch_id
                       WHERE pa.payout_id = %s AND ben.owner_id = %s
                         AND (bt.owner_id = %s OR p.batch_id IS NULL)
                       ORDER BY pa.attempt_no DESC LIMIT 1 FOR UPDATE OF pa""",
                    (uuid.UUID(payout.id), owner_id, owner_id),
                )).fetchone()
                if attempt is None:
                    raise RuntimeError("Aucun essai de paiement ouvert pour cette ligne.")
                if payout.status == "UNCERTAIN":
                    reason = self._failure_reason(payout)
                    cursor = await conn.execute(
                        """UPDATE payout_attempts SET failure_reason = %s
                           WHERE reference = %s AND status IN ('quoted', 'initialized', 'pending')""",
                        (reason, attempt["reference"]),
                    )
                    return cursor.rowcount > 0
                if db_status is None:
                    raise ValueError(f"Statut de paiement non pris en charge : {payout.status}")
                if db_status in {"initialized", "pending"} or (
                    db_status == "completed" and origin == "webhook"
                ):
                    await conn.execute(
                        """UPDATE payout_attempts SET failure_reason = NULL
                           WHERE reference = %s AND status IN ('quoted', 'initialized', 'pending')""",
                        (attempt["reference"],),
                    )
                row = await (await conn.execute(
                    """SELECT apply_payout_event(
                           %s, %s, %s, %s, %s, %s, NULL, NULL
                       ) AS result""",
                    (attempt["reference"], db_status, now(), origin, event_id,
                        self._failure_reason(payout) if db_status == "failed" else None),
                )).fetchone()
        return row["result"] in {"applied", "ignored_same"}

    @staticmethod
    def _failure_reason(payout: Payout) -> str | None:
        if payout.error_stage and payout.error:
            return f"{payout.error_stage}: {payout.error}"
        return payout.error

    async def register_webhook_event(self, event_id: str, event_type: str, reference: str | None,
                                     payload: dict, signature_valid: bool) -> bool:
        simulated = get_settings().bitnob_mock
        async with self._pool.connection() as conn:
            async with conn.transaction():
                row = await (await conn.execute(
                    """INSERT INTO webhook_events
                       (event_id, event_type, reference, payload, signature_valid, is_simulated)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (event_id) DO NOTHING
                       RETURNING id""",
                    (event_id, event_type, reference, Jsonb(payload), signature_valid, simulated),
                )).fetchone()
                if row is not None:
                    return True
                existing = await (await conn.execute(
                    """SELECT processed_at FROM webhook_events
                       WHERE event_id = %s FOR UPDATE""",
                    (event_id,),
                )).fetchone()
                return existing is not None and existing["processed_at"] is None

    async def finish_webhook_event(self, event_id: str) -> None:
        async with self._pool.connection() as conn:
            await conn.execute(
                "UPDATE webhook_events SET processed_at = now() WHERE event_id = %s",
                (event_id,),
            )

    async def find_payout(self, *, reference: str | None = None,
                          bitnob_payout_id: str | None = None) -> Payout | None:
        if not reference and not bitnob_payout_id:
            return None
        conditions = []
        params: list[str] = []
        if reference:
            conditions.append("(p.reference = %s OR a.reference = %s)")
            params.extend((reference, reference))
        if bitnob_payout_id:
            conditions.append("a.bitnob_payout_id = %s")
            params.append(bitnob_payout_id)
        query = self._payout_query() + " WHERE (" + " OR ".join(conditions) + ")"
        async with self._pool.connection() as conn:
            owner_id = await self._owner_id(conn)
            row = await (await conn.execute(
                query + " AND b.owner_id = %s AND (bt.owner_id = %s OR p.batch_id IS NULL)",
                (*params, owner_id, owner_id),
            )).fetchone()
        return self._payout_from_row(row) if row else None
