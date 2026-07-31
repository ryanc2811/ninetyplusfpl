from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    season: str
    provider_timeout_seconds: float


def get_settings() -> Settings:
    return Settings(
        database_url=os.getenv("DATABASE_URL", "sqlite:///./data/fpl.db"),
        season=os.getenv("FPL_SEASON", "2026/27"),
        provider_timeout_seconds=float(os.getenv("FPL_PROVIDER_TIMEOUT_SECONDS", "20")),
    )
