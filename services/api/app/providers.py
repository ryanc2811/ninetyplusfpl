from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional, Protocol

import httpx


@dataclass(frozen=True)
class ProviderPayload:
    source: str
    retrieved_at: datetime
    bootstrap: dict[str, Any]
    fixtures: list[dict[str, Any]]
    request_parameters: dict[str, Any]
    source_event_timestamp: Optional[datetime] = None


class FplProvider(Protocol):
    def fetch(self) -> ProviderPayload:
        ...


class OfficialFplProvider:
    bootstrap_url = "https://fantasy.premierleague.com/api/bootstrap-static/"
    fixtures_url = "https://fantasy.premierleague.com/api/fixtures/"

    def __init__(self, timeout_seconds: float = 20):
        self.timeout_seconds = timeout_seconds

    def fetch(self) -> ProviderPayload:
        headers = {"Accept": "application/json", "User-Agent": "NinetyPlus-Data/1.0"}
        with httpx.Client(timeout=self.timeout_seconds, headers=headers) as client:
            bootstrap_response = client.get(self.bootstrap_url)
            fixtures_response = client.get(self.fixtures_url)
            bootstrap_response.raise_for_status()
            fixtures_response.raise_for_status()

        return ProviderPayload(
            source="official-fpl-public-web",
            retrieved_at=datetime.now(timezone.utc),
            bootstrap=bootstrap_response.json(),
            fixtures=fixtures_response.json(),
            request_parameters={"urls": [self.bootstrap_url, self.fixtures_url]},
        )


class FixtureFplProvider:
    def __init__(
        self,
        bootstrap: dict[str, Any],
        fixtures: list[dict[str, Any]],
        retrieved_at: Optional[datetime] = None,
    ):
        self.bootstrap = bootstrap
        self.fixtures = fixtures
        self.retrieved_at = retrieved_at or datetime.now(timezone.utc)

    def fetch(self) -> ProviderPayload:
        return ProviderPayload(
            source="fixture-provider",
            retrieved_at=self.retrieved_at,
            bootstrap=self.bootstrap,
            fixtures=self.fixtures,
            request_parameters={"fixture": True},
        )
