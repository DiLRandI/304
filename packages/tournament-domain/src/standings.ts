export interface StandingResultInput {
  opponentId: string;
  winsFor: number;
  winsAgainst: number;
  finalTokenDifferential: number | null;
}

export interface StandingInput {
  teamId: string;
  drawOrder: number;
  results: StandingResultInput[];
}

export interface GroupStanding {
  teamId: string;
  played: number;
  matchWins: number;
  matchLosses: number;
  matchDifferential: number;
  tokenDifferential: number;
  drawOrder: number;
}

function miniTableWins(
  team: StandingInput,
  tiedIds: ReadonlySet<string>,
): number {
  return team.results
    .filter((result) => tiedIds.has(result.opponentId))
    .reduce((total, result) => total + result.winsFor, 0);
}

export function rankGroup(inputs: readonly StandingInput[]): GroupStanding[] {
  const byId = new Map(inputs.map((input) => [input.teamId, input]));
  const standings = inputs.map<GroupStanding>((input) => {
    const matchWins = input.results.reduce(
      (total, result) => total + result.winsFor,
      0,
    );
    const matchLosses = input.results.reduce(
      (total, result) => total + result.winsAgainst,
      0,
    );
    return {
      teamId: input.teamId,
      played: input.results.length,
      matchWins,
      matchLosses,
      matchDifferential: matchWins - matchLosses,
      tokenDifferential: input.results.reduce(
        (total, result) => total + (result.finalTokenDifferential ?? 0),
        0,
      ),
      drawOrder: input.drawOrder,
    };
  });
  return standings.sort((left, right) => {
    if (left.matchWins !== right.matchWins) {
      return right.matchWins - left.matchWins;
    }
    const tiedIds = new Set(
      standings
        .filter((standing) => standing.matchWins === left.matchWins)
        .map((standing) => standing.teamId),
    );
    const leftMini = miniTableWins(
      byId.get(left.teamId) as StandingInput,
      tiedIds,
    );
    const rightMini = miniTableWins(
      byId.get(right.teamId) as StandingInput,
      tiedIds,
    );
    return (
      rightMini - leftMini ||
      right.matchDifferential - left.matchDifferential ||
      right.tokenDifferential - left.tokenDifferential ||
      left.drawOrder - right.drawOrder
    );
  });
}
