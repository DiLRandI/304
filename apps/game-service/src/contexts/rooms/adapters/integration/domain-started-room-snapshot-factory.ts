import {
  getRuleProfile,
  initialTokens,
  startGameplayHand,
} from "@three-zero-four/gameplay";
import type { Room } from "@three-zero-four/room-domain";
import { serializeGameplaySnapshot } from "../../../gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import type { GameplayDealerSelector } from "../../../gameplay/application/gameplay-dealer-selector.js";
import type { GameplayHandShuffler } from "../../../gameplay/application/gameplay-hand-shuffler.js";
import type {
  StartedRoomSnapshot,
  StartedRoomSnapshotFactory,
} from "../../application/started-room-initialization.js";

export class DomainStartedRoomSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainStartedRoomSnapshotError";
  }
}

export class DomainStartedRoomSnapshotFactory
  implements StartedRoomSnapshotFactory
{
  constructor(
    private readonly dealers: GameplayDealerSelector,
    private readonly shuffler: GameplayHandShuffler,
  ) {}

  create(room: Room): StartedRoomSnapshot {
    if (room.status !== "in_hand") {
      throw new DomainStartedRoomSnapshotError(
        "Gameplay snapshots require a started room",
      );
    }
    const profile = getRuleProfile(room.profileId);
    const prepared = this.shuffler.prepare(profile, 1);
    return serializeGameplaySnapshot(
      startGameplayHand({
        dealer: this.dealers.select(profile),
        deck: prepared.deck,
        handNumber: 1,
        profile,
        secondBiddingEnabled: room.settings.enableSecondBidding,
        tokens: initialTokens(profile),
      }),
    );
  }
}
