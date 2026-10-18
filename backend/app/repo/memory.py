"""Stockage en mémoire : perdu au redémarrage. Pour dev, tests et démo sans DB."""
from app.domain import Batch, Payout, now


class MemoryRepo:
    def __init__(self) -> None:
        self.clear()

    async def open(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def check_connection(self) -> bool:
        return False

    def clear(self) -> None:
        self._batches: dict[str, Batch] = {}
        self._payouts: dict[str, Payout] = {}
        self._root_references: dict[str, str] = {}
        self._webhook_events: dict[str, bool] = {}

    async def create_batch(self, batch: Batch, payouts: list[Payout]) -> None:
        self._batches[batch.id] = batch
        for p in payouts:
            self._payouts[p.id] = p
            self._root_references[p.id] = p.reference

    async def get_batch(self, batch_id: str) -> Batch | None:
        return self._batches.get(batch_id)

    async def list_batches(self) -> list[Batch]:
        return sorted(self._batches.values(), key=lambda b: b.created_at, reverse=True)

    async def save_batch(self, batch: Batch) -> None:
        batch.updated_at = now()
        self._batches[batch.id] = batch

    async def get_payout(self, payout_id: str) -> Payout | None:
        return self._payouts.get(payout_id)

    async def list_payouts(self, batch_id: str | None = None) -> list[Payout]:
        items = [p for p in self._payouts.values() if batch_id is None or p.batch_id == batch_id]
        return sorted(items, key=lambda p: (p.batch_id, p.line))

    async def save_payout(self, payout: Payout) -> None:
        payout.updated_at = now()
        self._payouts[payout.id] = payout

    async def start_payout_attempt(self, payout_id: str) -> str:
        payout = self._payouts[payout_id]
        reference = self._root_references[payout_id]
        if payout.attempts:
            reference = f"{reference}-r{payout.attempts}"
        payout.reference = reference
        return reference

    async def apply_payout_status(self, payout: Payout, *, origin: str,
                                  event_id: str | None = None) -> bool:
        await self.save_payout(payout)
        return True

    async def register_webhook_event(self, event_id: str, event_type: str, reference: str | None,
                                     payload: dict, signature_valid: bool) -> bool:
        if self._webhook_events.get(event_id):
            return False
        self._webhook_events.setdefault(event_id, False)
        return True

    async def finish_webhook_event(self, event_id: str) -> None:
        self._webhook_events[event_id] = True

    async def find_payout(self, *, reference: str | None = None,
                          bitnob_payout_id: str | None = None) -> Payout | None:
        for p in self._payouts.values():
            root_reference = self._root_references[p.id]
            expected_reference = (
                f"{root_reference}-r{p.attempts}" if p.attempts else root_reference
            )
            if reference and reference in {root_reference, expected_reference, p.reference}:
                return p
            if bitnob_payout_id and p.bitnob_payout_id == bitnob_payout_id:
                return p
        return None
