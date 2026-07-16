import { randomInt } from "node:crypto";
import { type RuleProfile, seatIndex } from "@three-zero-four/gameplay";
import type { GameplayDealerSelector } from "../../application/gameplay-dealer-selector.js";

export class NodeGameplayDealerSelector implements GameplayDealerSelector {
  select(profile: RuleProfile) {
    return seatIndex(randomInt(profile.seatCount), profile.seatCount);
  }
}
