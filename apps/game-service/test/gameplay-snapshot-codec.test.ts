import { GameEngine } from "@three-zero-four/game-engine";
import {
  buildDeck,
  getRuleProfile,
  initialTokens,
  seatIndex,
  startGameplayHand,
} from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import {
  GameplaySnapshotCodecError,
  hydrateGameplaySnapshot,
  serializeGameplaySnapshot,
} from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";

function hand(profileId: "classic_304_4p" | "six_304_36") {
  const profile = getRuleProfile(profileId);
  return startGameplayHand({
    dealer: seatIndex(0, profile.seatCount),
    deck: buildDeck(profile),
    handNumber: 1,
    profile,
    secondBiddingEnabled: true,
    tokens: initialTokens(profile),
  });
}

describe("gameplay snapshot codec", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("round-trips a versioned %s aggregate snapshot", (profileId) => {
    const aggregate = hand(profileId);
    const record = serializeGameplaySnapshot(aggregate);

    expect(record).toMatchObject({
      ruleProfileId: profileId,
      schemaVersion: 2,
      state: { handNumber: 1, phase: "four-bidding" },
    });
    expect(hydrateGameplaySnapshot(record)).toEqual(aggregate);
  });

  it("does not let hydrated mutations alter the persisted JSON value", () => {
    const record = serializeGameplaySnapshot(hand("classic_304_4p"));
    const hydrated = hydrateGameplaySnapshot(record);
    const firstHand = hydrated.deal.hands[0] as unknown[];

    firstHand.pop();

    expect(hydrateGameplaySnapshot(record).deal.hands[0]).toHaveLength(4);
  });

  it("hydrates a production schema-v1 started snapshot", () => {
    const engine = new GameEngine({
      humanCount: 4,
      ruleProfile: "classic_304_4p",
    });
    engine.startMatch();

    const hydrated = hydrateGameplaySnapshot({
      ruleProfileId: "classic_304_4p",
      schemaVersion: 1,
      state: engine.getSnapshot(),
    });

    expect(hydrated.phase).toBe("four-bidding");
    expect(hydrated.profile.id).toBe("classic_304_4p");
  });

  it("rejects unsupported snapshot versions", () => {
    expect(() =>
      hydrateGameplaySnapshot({
        ...serializeGameplaySnapshot(hand("classic_304_4p")),
        schemaVersion: 3,
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot version is not supported",
      ),
    );
  });

  it("rejects structurally invalid aggregate state", () => {
    const record = serializeGameplaySnapshot(hand("classic_304_4p"));
    expect(() =>
      hydrateGameplaySnapshot({
        ...record,
        state: { ...(record.state as object), capturedCards: [] },
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "INVALID_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot state is invalid",
      ),
    );
  });
});
