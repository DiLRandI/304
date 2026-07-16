import type { RuleProfile, SeatIndex } from "@three-zero-four/gameplay";

export interface GameplayDealerSelector {
  select(profile: RuleProfile): SeatIndex;
}
