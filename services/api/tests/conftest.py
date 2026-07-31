import json
import csv
import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


@pytest.fixture
def fpl_payload():
    fixture_dir = Path(__file__).parent / "fixtures"
    bootstrap = json.loads((fixture_dir / "bootstrap.json").read_text())
    fixtures = json.loads((fixture_dir / "fixtures.json").read_text())
    return bootstrap, fixtures


def build_historical_minutes_csv(start: datetime, player_id_offset: int = 0):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "gameweek",
            "player_id",
            "player_name",
            "position",
            "team_name",
            "opponent_name",
            "fixture_id",
            "kickoff_time",
            "was_home",
            "difficulty",
            "minutes",
            "started",
            "total_points",
            "goals_scored",
            "assists",
            "clean_sheets",
            "saves",
            "yellow_cards",
            "bonus",
            "bps",
            "defensive_contributions",
        ]
    )
    players = [
        (101 + player_id_offset, "Alex Keeper", "GK", "North City"),
        (102 + player_id_offset, "Drew Back", "DEF", "North City"),
        (201 + player_id_offset, "Sam Middle", "MID", "South United"),
        (202 + player_id_offset, "Jo Forward", "FWD", "South United"),
    ]
    for gameweek in range(1, 13):
        kickoff = start + timedelta(days=(gameweek - 1) * 7)
        for index, (player_id, name, position, team) in enumerate(players):
            base_player_id = player_id - player_id_offset
            if base_player_id == 101:
                minutes, started = (90 - (gameweek % 4) * 5), True
            elif base_player_id == 102:
                minutes, started = ((12 + gameweek) if gameweek % 2 else 0), False
            elif base_player_id == 201:
                minutes, started = (55 + (gameweek % 3) * 10), True
            else:
                minutes, started = ((8 + gameweek) if gameweek % 2 == 0 else 0), False
            goals = int(
                minutes > 0
                and (
                    (base_player_id == 201 and gameweek % 4 == 0)
                    or (base_player_id == 202 and gameweek % 2 == 0)
                )
            )
            assists = int(
                minutes > 0
                and base_player_id in {102, 201}
                and gameweek % 3 == 0
            )
            clean_sheets = int(
                minutes >= 60
                and base_player_id in {101, 102}
                and gameweek % 3 == 1
            )
            saves = 2 + gameweek % 5 if base_player_id == 101 and minutes > 0 else 0
            yellow_cards = int(minutes > 0 and gameweek % 6 == 0)
            defensive_contributions = (
                10 + gameweek % 4
                if minutes > 0 and base_player_id == 102
                else 12 + gameweek % 3
                if minutes > 0 and base_player_id == 201
                else 3 if minutes > 0 and base_player_id == 202 else 0
            )
            bonus = 3 if goals and gameweek % 4 == 0 else 1 if clean_sheets else 0
            bps = (
                int(minutes > 0) * 6
                + goals * (18 if position == "MID" else 24)
                + assists * 9
                + clean_sheets * 12
                + saves * 2
                + defensive_contributions // 3
            )
            writer.writerow(
                [
                    gameweek,
                    player_id,
                    name,
                    position,
                    team,
                    "South United" if team == "North City" else "North City",
                    gameweek * 10 + index,
                    kickoff.isoformat(),
                    str((gameweek + index) % 2 == 0).lower(),
                    2 + ((gameweek + index) % 4),
                    minutes,
                    str(started).lower(),
                    max(0, minutes // 15),
                    goals,
                    assists,
                    clean_sheets,
                    saves,
                    yellow_cards,
                    bonus,
                    bps,
                    defensive_contributions,
                ]
            )
    return output.getvalue()


@pytest.fixture
def historical_minutes_csv():
    return build_historical_minutes_csv(
        datetime(2025, 8, 9, 14, tzinfo=timezone.utc)
    )


@pytest.fixture
def prior_season_minutes_csv():
    return build_historical_minutes_csv(
        datetime(2024, 8, 10, 14, tzinfo=timezone.utc),
        player_id_offset=1000,
    )


@pytest.fixture
def historical_team_matches_csv():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "gameweek",
            "fixture_id",
            "kickoff_time",
            "home_team",
            "away_team",
            "home_goals",
            "away_goals",
        ]
    )
    teams = ["NTH", "STH", "EAS", "WST"]
    strength = {"NTH": 3, "STH": 2, "EAS": 1, "WST": 0}
    start = datetime(2024, 8, 10, 14, tzinfo=timezone.utc)
    schedules = [
        (("NTH", "WST"), ("STH", "EAS")),
        (("WST", "STH"), ("EAS", "NTH")),
        (("NTH", "STH"), ("WST", "EAS")),
    ]
    fixture_id = 1
    for gameweek in range(1, 13):
        kickoff = start + timedelta(days=(gameweek - 1) * 7)
        for home_team, away_team in schedules[(gameweek - 1) % len(schedules)]:
            home_goals = max(
                0,
                1 + strength[home_team] - strength[away_team] // 2 + gameweek % 2,
            )
            away_goals = max(
                0,
                strength[away_team] - strength[home_team] // 2 + (gameweek + 1) % 2,
            )
            writer.writerow(
                [
                    gameweek,
                    fixture_id,
                    kickoff.isoformat(),
                    home_team,
                    away_team,
                    min(home_goals, 5),
                    min(away_goals, 4),
                ]
            )
            fixture_id += 1
    assert set(teams) == {"NTH", "STH", "EAS", "WST"}
    return output.getvalue()
