import type { Card, RuleProfile } from "@three-zero-four/gameplay";

export interface GameplayShuffleAudit {
  readonly algorithm: "hmac-sha256-v1";
  readonly commitment: string;
  readonly seed: string;
}

export interface PreparedGameplayHandDeck {
  readonly audit: GameplayShuffleAudit;
  readonly deck: readonly Card[];
}

export interface GameplayHandShuffler {
  prepare(profile: RuleProfile, handNumber: number): PreparedGameplayHandDeck;
}
