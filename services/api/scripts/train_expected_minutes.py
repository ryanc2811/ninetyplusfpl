from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.database import SessionLocal
from app.expected_minutes import train_expected_minutes
from app.historical import import_historical_csv_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import an approved player-Gameweek CSV and train Expected Minutes v2."
    )
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--season", required=True)
    parser.add_argument(
        "--license-status",
        choices=["licensed", "confirmed-open", "development-only"],
        required=True,
    )
    args = parser.parse_args()

    with SessionLocal() as session:
        imported = import_historical_csv_path(
            session,
            args.csv_path,
            source=args.source,
            season_id=args.season,
            license_status=args.license_status,
        )
        model_run = train_expected_minutes(session, [imported.dataset_id])
        print(
            json.dumps(
                {
                    "dataset_id": imported.dataset_id,
                    "model_run_id": model_run.id,
                    "model_version": model_run.model_version,
                    "metrics": model_run.metrics,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
