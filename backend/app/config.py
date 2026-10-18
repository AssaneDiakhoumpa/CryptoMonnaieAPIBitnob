from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    bitnob_client_id: str = ""
    bitnob_client_secret: str = ""
    bitnob_base_url: str = "https://api.bitnob.com"
    bitnob_customer_id: str = ""
    database_url: str = ""
    public_base_url: str = ""
    app_api_key: str = "change-me"
    confirm_payout: bool = False

    default_card_customer_id: str = ""
    alert_threshold_usd: float = 10.0

    # Mode simulé : aucun appel à Bitnob, tout est répondu en local
    bitnob_mock: bool = False
    mock_delay_seconds: float = 2.0        # délai entre les étapes simulées (webhooks)
    mock_balance_usd: float = 1000.0       # solde de départ des wallets simulés
    mock_invoice_pay_seconds: float = 0.0  # >0 : les factures se paient seules après N s

    # Paiements de masse
    bulk_concurrency: int = 3         # payouts traités en parallèle
    bulk_max_rows: int = 500

    @property
    def webhook_url(self) -> str | None:
        return f"{self.public_base_url.rstrip('/')}/webhooks/bitnob" if self.public_base_url else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
