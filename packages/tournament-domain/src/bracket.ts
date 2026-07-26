export interface QualifierSeed {
  teamId: string;
  groupId: string;
  groupRank: 1 | 2;
  normalizedWinRate: number;
  normalizedDifferential: number;
}

export interface BracketFixture {
  home: string;
  away: string | null;
  homeGroupId: string;
  awayGroupId: string | null;
}

export interface KnockoutBracket {
  size: number;
  firstRound: BracketFixture[];
  thirdPlace: boolean;
}

function compareSeeds(left: QualifierSeed, right: QualifierSeed): number {
  return (
    left.groupRank - right.groupRank ||
    right.normalizedWinRate - left.normalizedWinRate ||
    right.normalizedDifferential - left.normalizedDifferential ||
    left.teamId.localeCompare(right.teamId)
  );
}

export function createKnockoutBracket(
  qualifiers: readonly QualifierSeed[],
  thirdPlace: boolean,
): KnockoutBracket {
  if (
    qualifiers.length < 2 ||
    new Set(qualifiers.map((seed) => seed.teamId)).size !== qualifiers.length
  ) {
    throw new Error("Knockout requires unique qualifiers");
  }
  const seeds = [...qualifiers].sort(compareSeeds);
  const size = 2 ** Math.ceil(Math.log2(seeds.length));
  const byeCount = size - seeds.length;
  const byes = seeds.slice(0, byeCount);
  const remaining = seeds.slice(byeCount);
  const firstRound: BracketFixture[] = byes.map((seed) => ({
    home: seed.teamId,
    away: null,
    homeGroupId: seed.groupId,
    awayGroupId: null,
  }));

  while (remaining.length > 0) {
    const home = remaining.shift();
    if (home === undefined) {
      break;
    }
    let awayIndex = remaining.length - 1;
    if (remaining[awayIndex]?.groupId === home.groupId) {
      const alternative = remaining.findLastIndex(
        (seed) => seed.groupId !== home.groupId,
      );
      if (alternative >= 0) {
        awayIndex = alternative;
      }
    }
    const [away] = remaining.splice(awayIndex, 1);
    if (away === undefined) {
      throw new Error("Invalid knockout pairing state");
    }
    firstRound.push({
      home: home.teamId,
      away: away.teamId,
      homeGroupId: home.groupId,
      awayGroupId: away.groupId,
    });
  }
  return { size, firstRound, thirdPlace };
}
