export interface ScheduledPairing {
  home: string;
  away: string;
}

function seedNumber(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(state: { value: number }): number {
  state.value += 0x6d2b79f5;
  let value = state.value;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function seededShuffle<T>(values: readonly T[], seed: string): T[] {
  const shuffled = [...values];
  const state = { value: seedNumber(seed) };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(nextRandom(state) * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[target];
    if (current === undefined || replacement === undefined) {
      throw new Error("Invalid shuffle state");
    }
    shuffled[index] = replacement;
    shuffled[target] = current;
  }
  return shuffled;
}

export function createBalancedGroups(
  teamIds: readonly string[],
  seed: string,
): string[][] {
  if (teamIds.length < 6 || teamIds.length > 32 || teamIds.length % 2 !== 0) {
    throw new Error("Tournament requires an even team count from 6-32");
  }
  if (new Set(teamIds).size !== teamIds.length) {
    throw new Error("Tournament teams must be unique");
  }
  const groupCount = Math.max(2, Math.floor(teamIds.length / 4));
  const groups = Array.from({ length: groupCount }, () => [] as string[]);
  for (const [index, teamId] of seededShuffle(teamIds, seed).entries()) {
    groups[index % groupCount]?.push(teamId);
  }
  return groups;
}

export function createRoundRobinSchedule(
  teamIds: readonly string[],
): ScheduledPairing[][] {
  if (teamIds.length < 2 || new Set(teamIds).size !== teamIds.length) {
    throw new Error("Round robin requires unique teams");
  }
  const bye = "__bye__";
  const rotation = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, bye];
  const rounds: ScheduledPairing[][] = [];
  for (let roundIndex = 0; roundIndex < rotation.length - 1; roundIndex += 1) {
    const round: ScheduledPairing[] = [];
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const home = rotation[index];
      const away = rotation[rotation.length - 1 - index];
      if (
        home !== undefined &&
        away !== undefined &&
        home !== bye &&
        away !== bye
      ) {
        round.push(
          roundIndex % 2 === 0 ? { home, away } : { home: away, away: home },
        );
      }
    }
    rounds.push(round);
    const fixed = rotation[0];
    const rest = rotation.slice(1);
    const last = rest.pop();
    if (fixed === undefined || last === undefined) {
      throw new Error("Invalid round-robin state");
    }
    rotation.splice(0, rotation.length, fixed, last, ...rest);
  }
  return rounds;
}
