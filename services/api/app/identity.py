from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    HistoricalDataset,
    PlayerGameweekObservation,
    PlayerIdentity,
    PlayerIdentityAlias,
    PlayerSnapshot,
    SnapshotPlayerIdentity,
)


@dataclass(frozen=True)
class IdentityResolution:
    player_identity_id: str | None
    normalized_name: str
    match_method: str
    confidence: float
    review_status: str


@dataclass(frozen=True)
class IdentityCoverage:
    snapshot_id: str
    total: int
    resolved: int
    automatic: int
    review_required: int
    unresolved: int


def normalize_player_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_marks = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return " ".join(
        "".join(character if character.isalnum() else " " for character in without_marks).split()
    )


def _candidates(session: Session, normalized_name: str) -> list[PlayerIdentity]:
    return list(
        session.scalars(
            select(PlayerIdentity).where(PlayerIdentity.normalized_name == normalized_name)
        )
    )


def resolve_historical_identity(
    session: Session,
    *,
    source: str,
    season_id: str,
    source_player_id: int,
    source_name: str,
    position: str,
) -> IdentityResolution:
    existing = session.scalar(
        select(PlayerIdentityAlias).where(
            PlayerIdentityAlias.source == source,
            PlayerIdentityAlias.season_id == season_id,
            PlayerIdentityAlias.source_player_id == source_player_id,
        )
    )
    if existing:
        return IdentityResolution(
            existing.player_identity_id,
            existing.normalized_name,
            existing.match_method,
            existing.confidence,
            existing.review_status,
        )

    normalized_name = normalize_player_name(source_name)
    candidates = _candidates(session, normalized_name) if normalized_name not in {"", "unknown"} else []
    same_position = [candidate for candidate in candidates if candidate.primary_position == position]
    if len(same_position) == 1:
        identity = same_position[0]
        method, confidence, review_status = "exact-name-position", 1.0, "automatic"
    elif len(candidates) == 1:
        identity = candidates[0]
        method, confidence, review_status = "exact-name-position-change", 0.85, "review-required"
    elif candidates:
        identity = None
        method, confidence, review_status = "ambiguous-exact-name", 0.0, "unresolved"
    elif normalized_name in {"", "unknown"}:
        identity = None
        method, confidence, review_status = "invalid-name", 0.0, "unresolved"
    else:
        identity = PlayerIdentity(
            id=str(uuid.uuid4()),
            canonical_name=source_name,
            normalized_name=normalized_name,
            primary_position=position,
            created_at=datetime.now(timezone.utc),
            status="active",
        )
        session.add(identity)
        session.flush()
        method, confidence, review_status = "created-canonical", 1.0, "automatic"

    alias = PlayerIdentityAlias(
        player_identity_id=identity.id if identity else None,
        source=source,
        season_id=season_id,
        source_player_id=source_player_id,
        source_name=source_name,
        normalized_name=normalized_name,
        position=position,
        match_method=method,
        confidence=confidence,
        review_status=review_status,
        created_at=datetime.now(timezone.utc),
    )
    session.add(alias)
    session.flush()
    return IdentityResolution(
        alias.player_identity_id,
        normalized_name,
        method,
        confidence,
        review_status,
    )


def backfill_historical_identities(
    session: Session,
    dataset_ids: list[str],
) -> int:
    datasets = {
        dataset.id: dataset
        for dataset in session.scalars(
            select(HistoricalDataset).where(HistoricalDataset.id.in_(dataset_ids))
        )
    }
    observations = list(
        session.scalars(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.dataset_id.in_(dataset_ids),
                PlayerGameweekObservation.player_identity_id.is_(None),
            )
        )
    )
    for observation in observations:
        dataset = datasets[observation.dataset_id]
        resolution = resolve_historical_identity(
            session,
            source=dataset.source,
            season_id=observation.season_id,
            source_player_id=observation.player_source_id,
            source_name=observation.player_name,
            position=observation.position,
        )
        observation.player_identity_id = resolution.player_identity_id
    session.commit()
    return len(observations)


def _resolve_current_player(
    session: Session,
    *,
    season_id: str,
    player: PlayerSnapshot,
) -> IdentityResolution:
    existing_alias = session.scalar(
        select(PlayerIdentityAlias).where(
            PlayerIdentityAlias.source == "official-fpl-current",
            PlayerIdentityAlias.season_id == season_id,
            PlayerIdentityAlias.source_player_id == player.source_id,
        )
    )
    if existing_alias:
        return IdentityResolution(
            existing_alias.player_identity_id,
            existing_alias.normalized_name,
            existing_alias.match_method,
            existing_alias.confidence,
            existing_alias.review_status,
        )

    full_name = " ".join(value for value in [player.first_name, player.second_name] if value).strip()
    full_name = full_name or player.web_name
    normalized_full_name = normalize_player_name(full_name)
    exact_candidates = _candidates(session, normalized_full_name)
    exact_position = [
        candidate for candidate in exact_candidates if candidate.primary_position == player.position
    ]
    if len(exact_position) == 1:
        identity = exact_position[0]
        method, confidence, review_status = "exact-full-name-position", 1.0, "automatic"
    elif len(exact_candidates) == 1:
        identity = exact_candidates[0]
        method, confidence, review_status = "exact-full-name-position-change", 0.85, "review-required"
    else:
        normalized_web_name = normalize_player_name(player.web_name)
        web_candidates = [
            candidate
            for candidate in _candidates(session, normalized_web_name)
            if candidate.primary_position == player.position
        ]
        if not exact_candidates and len(web_candidates) == 1:
            identity = web_candidates[0]
            method, confidence, review_status = "surname-position-fallback", 0.7, "review-required"
        elif exact_candidates or len(web_candidates) > 1:
            identity = None
            method, confidence, review_status = "ambiguous-current-name", 0.0, "unresolved"
        else:
            identity = PlayerIdentity(
                id=str(uuid.uuid4()),
                canonical_name=full_name,
                normalized_name=normalized_full_name,
                primary_position=player.position,
                created_at=datetime.now(timezone.utc),
                status="active",
            )
            session.add(identity)
            session.flush()
            method, confidence, review_status = "created-current-canonical", 1.0, "automatic"

    alias = PlayerIdentityAlias(
        player_identity_id=identity.id if identity else None,
        source="official-fpl-current",
        season_id=season_id,
        source_player_id=player.source_id,
        source_name=full_name,
        normalized_name=normalized_full_name,
        position=player.position,
        match_method=method,
        confidence=confidence,
        review_status=review_status,
        created_at=datetime.now(timezone.utc),
    )
    session.add(alias)
    session.flush()
    return IdentityResolution(
        alias.player_identity_id,
        alias.normalized_name,
        method,
        confidence,
        review_status,
    )


def resolve_snapshot_identities(
    session: Session,
    snapshot_id: str,
    season_id: str,
) -> IdentityCoverage:
    players = list(
        session.scalars(select(PlayerSnapshot).where(PlayerSnapshot.snapshot_id == snapshot_id))
    )
    mappings: list[SnapshotPlayerIdentity] = []
    for player in players:
        existing = session.scalar(
            select(SnapshotPlayerIdentity).where(
                SnapshotPlayerIdentity.snapshot_id == snapshot_id,
                SnapshotPlayerIdentity.player_source_id == player.source_id,
            )
        )
        if existing:
            mappings.append(existing)
            continue
        resolution = _resolve_current_player(session, season_id=season_id, player=player)
        mapping = SnapshotPlayerIdentity(
            snapshot_id=snapshot_id,
            player_source_id=player.source_id,
            player_identity_id=resolution.player_identity_id,
            normalized_name=resolution.normalized_name,
            match_method=resolution.match_method,
            confidence=resolution.confidence,
            review_status=resolution.review_status,
            created_at=datetime.now(timezone.utc),
        )
        session.add(mapping)
        mappings.append(mapping)
    session.commit()
    return IdentityCoverage(
        snapshot_id=snapshot_id,
        total=len(mappings),
        resolved=sum(mapping.player_identity_id is not None for mapping in mappings),
        automatic=sum(mapping.review_status == "automatic" for mapping in mappings),
        review_required=sum(mapping.review_status == "review-required" for mapping in mappings),
        unresolved=sum(mapping.review_status == "unresolved" for mapping in mappings),
    )


def snapshot_identity_coverage(session: Session, snapshot_id: str) -> IdentityCoverage:
    mappings = list(
        session.scalars(
            select(SnapshotPlayerIdentity).where(
                SnapshotPlayerIdentity.snapshot_id == snapshot_id
            )
        )
    )
    return IdentityCoverage(
        snapshot_id=snapshot_id,
        total=len(mappings),
        resolved=sum(mapping.player_identity_id is not None for mapping in mappings),
        automatic=sum(mapping.review_status == "automatic" for mapping in mappings),
        review_required=sum(mapping.review_status == "review-required" for mapping in mappings),
        unresolved=sum(mapping.review_status == "unresolved" for mapping in mappings),
    )
