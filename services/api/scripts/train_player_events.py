from __future__ import annotations

import argparse
import json

from app.database import SessionLocal
from app.player_events import backtest_player_events, train_player_events


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train and expanding-window backtest the player-event prior model."
    )
    parser.add_argument("dataset_ids", nargs="+")
    parser.add_argument("--minimum-history", type=int, default=6)
    parser.add_argument("--initial-training-gameweeks", type=int, default=6)
    args = parser.parse_args()

    with SessionLocal() as session:
        model = train_player_events(
            session,
            args.dataset_ids,
            minimum_history=args.minimum_history,
        )
        backtest = backtest_player_events(
            session,
            args.dataset_ids,
            initial_training_gameweeks=args.initial_training_gameweeks,
        )
        print(
            json.dumps(
                {
                    "model_run_id": model.id,
                    "model_version": model.model_version,
                    "metrics": model.metrics,
                    "backtest_id": backtest.id,
                    "backtest_verdict": backtest.verdict,
                    "backtest_metrics": backtest.aggregate_metrics,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
