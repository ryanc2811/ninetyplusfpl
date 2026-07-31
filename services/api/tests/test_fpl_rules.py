from app.fpl_rules import RULES_2026_27, allocate_bonus_points


def test_2026_27_defensive_contribution_thresholds_and_scoring():
    assert RULES_2026_27.defensive_contribution_threshold("DEF") == 10
    assert RULES_2026_27.defensive_contribution_threshold("MID") == 12
    assert RULES_2026_27.defensive_contribution_threshold("FWD") == 12
    assert RULES_2026_27.defensive_contribution_points == 2
    assert RULES_2026_27.clean_sheet_points("DEF") == 4
    assert RULES_2026_27.goal_points("MID") == 5


def test_bonus_allocation_matches_official_tie_rules():
    assert allocate_bonus_points([20, 19, 18, 17], [True] * 4) == [3, 2, 1, 0]
    assert allocate_bonus_points([20, 20, 18, 17], [True] * 4) == [3, 3, 1, 0]
    assert allocate_bonus_points([20, 18, 18, 17], [True] * 4) == [3, 2, 2, 0]
    assert allocate_bonus_points([20, 18, 17, 17], [True] * 4) == [3, 2, 1, 1]
    assert allocate_bonus_points([99, 20, 19], [False, True, True]) == [0, 3, 2]
