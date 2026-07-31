from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.database import SessionLocal
from app.historical import import_historical_csv_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import one approved historical season without training a model."
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
        print(
            json.dumps(
                {
                    "dataset_id": imported.dataset_id,
                    "checksum": imported.checksum,
                    "row_count": imported.row_count,
                    "created": imported.created,
                    "inferred_start_count": imported.inferred_start_count,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
