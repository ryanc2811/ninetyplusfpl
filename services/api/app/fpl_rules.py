from __future__ import annotations

from dataclasses import dataclass


RULES_VERSION = "fpl-2026-27-v1"


@dataclass(frozen=True)
class ScoringRules:
    appearance_under_60: int = 1
    appearance_60_plus: int = 2
    assist: int = 3
    clean_sheet_gk_def: int = 4
    clean_sheet_mid: int = 1
    saves_per_point: int = 3
    yellow_card: int = -1
    red_card: int = -3
    own_goal: int = -2
    penalty_miss: int = -2
    penalty_save: int = 5
    goals_conceded_per_deduction: int = 2
    defensive_contribution_points: int = 2
    defender_defensive_contribution_threshold: int = 10
    midfielder_forward_defensive_contribution_threshold: int = 12

    @staticmethod
    def goal_points(position: str) -> int:
        return {"GK": 10, "DEF": 6, "MID": 5, "FWD": 4}[position]

    @staticmethod
    def clean_sheet_points(position: str) -> int:
        return {"GK": 4, "DEF": 4, "MID": 1, "FWD": 0}[position]

    def defensive_contribution_threshold(self, position: str) -> int:
        if position == "DEF":
            return self.defender_defensive_contribution_threshold
        if position in {"MID", "FWD"}:
            return self.midfielder_forward_defensive_contribution_threshold
        return 10**9


RULES_2026_27 = ScoringRules()


def allocate_bonus_points(bps_scores: list[float], appeared: list[bool]) -> list[int]:
    """Apply official competition ranking, including first/second/third-place ties."""
    eligible = [score for score, did_appear in zip(bps_scores, appeared) if did_appear]
    bonuses = [0] * len(bps_scores)
    if not eligible:
        return bonuses
    for index, (score, did_appear) in enumerate(zip(bps_scores, appeared)):
        if not did_appear:
            continue
        rank = 1 + sum(other > score for other in eligible)
        bonuses[index] = {1: 3, 2: 2, 3: 1}.get(rank, 0)
    return bonuses
