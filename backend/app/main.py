import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg import Error as PostgresError
from psycopg_pool import PoolClosed, PoolTimeout

from app.bitnob.client import BitnobClient, BitnobError
from app.config import get_settings
from app.repo import get_repo
from app.repo.base import RepositoryConfigurationError
from app.routers import batches, bitnob_proxy, cards, dashboard, envelopes, invoices, mock, webhooks

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if s.bitnob_mock:
        from app.bitnob.mock import MockBitnobClient
        app.state.bitnob = MockBitnobClient(s)
        logging.getLogger("main").warning("MODE SIMULÉ : aucun appel à Bitnob.")
    else:
        if not s.bitnob_client_id or not s.bitnob_client_secret:
            raise RuntimeError("BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET manquants "
                               "(ou mettre BITNOB_MOCK=true pour le mode simulé).")
        app.state.bitnob = BitnobClient(s)
    app.state.repo = get_repo()
    try:
        await app.state.repo.open()
    except Exception:
        await app.state.repo.close()
        await app.state.bitnob.aclose()
        raise
    try:
        yield
    finally:
        await app.state.bitnob.aclose()
        await app.state.repo.close()


app = FastAPI(title="Bitnob Backend Kit", version="0.3.0", lifespan=lifespan)


@app.exception_handler(BitnobError)
async def bitnob_error_handler(_: Request, exc: BitnobError):
    status = 502 if exc.status_code >= 500 else exc.status_code
    return JSONResponse(status_code=status, content={"error": "bitnob_error", "details": exc.payload})


@app.exception_handler(RepositoryConfigurationError)
async def repository_configuration_error_handler(_: Request, exc: RepositoryConfigurationError):
    return JSONResponse(status_code=503, content={"error": str(exc)})


@app.exception_handler(PostgresError)
async def postgres_error_handler(_: Request, exc: PostgresError):
    logging.getLogger("database").error("database operation failed (SQLSTATE %s)", exc.sqlstate)
    return JSONResponse(status_code=503, content={"error": "database_error"})


@app.exception_handler(PoolClosed)
@app.exception_handler(PoolTimeout)
async def pool_error_handler(_: Request, __: Exception):
    return JSONResponse(status_code=503, content={"error": "database_unavailable"})


@app.get("/health", tags=["system"])
async def health(request: Request):
    """`mode` = "mock" : les réponses sont simulées (afficher un bandeau dans le frontend)."""
    try:
        db_connected = await request.app.state.repo.check_connection()
    except (PostgresError, PoolClosed, PoolTimeout):
        db_connected = False
    demo_mode = getattr(request.app.state.bitnob, "mock", False)
    return {
        "status": "ok",
        "mode": "mock" if demo_mode else "live",
        "demo": demo_mode,
        "db": db_connected,
    }


app.include_router(bitnob_proxy.router)   # whoami, balances, payouts
app.include_router(cards.router)          # KYC, cartes brutes, simulation sandbox
app.include_router(envelopes.router)      # enveloppes budgétaires
app.include_router(envelopes.alerts_router)
app.include_router(invoices.router)       # factures Bitcoin + QR
app.include_router(batches.router)        # paiements de masse
app.include_router(dashboard.router)      # KPIs
app.include_router(webhooks.router)
app.include_router(mock.router)           # /mock/* : 404 hors mode simulé
