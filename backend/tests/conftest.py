import pytest

import app.repo as repository
from app.config import Settings


@pytest.fixture(autouse=True)
def use_memory_repository(monkeypatch):
    monkeypatch.setattr(repository, "get_settings", lambda: Settings(database_url=""))
    repository.get_repo.cache_clear()
    repository.get_repo().clear()
    yield
    repository.get_repo.cache_clear()
