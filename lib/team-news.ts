export type ReplacementCandidateSignal = {
  player: string;
  opportunityShare: number;
};

export type TeamRoleSignal = {
  unavailablePlayer: string;
  replacements: ReplacementCandidateSignal[];
  confidence: number;
  rationale: string;
  sourceUrl: string;
};

/**
 * Provider-independent, source-attributed role signals.
 *
 * A signal only activates when the official FPL availability fields also mark
 * the named player unavailable. This prevents a stale role note from affecting
 * forecasts after the player returns.
 */
export const VERIFIED_TEAM_ROLE_SIGNALS: TeamRoleSignal[] = [
  {
    unavailablePlayer: "Saliba",
    replacements: [
      { player: "Mosquera", opportunityShare: 0.55 },
      { player: "Calafiori", opportunityShare: 0.2 },
      { player: "White", opportunityShare: 0.15 },
      { player: "Hincapie", opportunityShare: 0.1 },
    ],
    confidence: 0.72,
    rationale:
      "Saliba is unavailable for an extended period; Mosquera is the leading natural replacement, with alternative defensive configurations retained.",
    sourceUrl:
      "https://www.premierleague.com/en/news/4681112/early-scout-selection-the-best-fantasy-squad-for-202627",
  },
];

