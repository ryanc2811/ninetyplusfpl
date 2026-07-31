from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings


class Base(DeclarativeBase):
    pass


def create_database_engine(database_url: str):
    if database_url.startswith("sqlite:///"):
        database_path = database_url.removeprefix("sqlite:///")
        if database_path != ":memory:":
            Path(database_path).parent.mkdir(parents=True, exist_ok=True)
    engine_options = {
        "connect_args": {"check_same_thread": False} if database_url.startswith("sqlite") else {},
        "pool_pre_ping": True,
    }
    if database_url in {"sqlite://", "sqlite:///:memory:"}:
        engine_options["poolclass"] = StaticPool
    return create_engine(database_url, **engine_options)


engine = create_database_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
