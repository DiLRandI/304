import { describe, expect, it } from "vitest";
import {
  GameplaySnapshotCodecError,
  hydrateGameplaySnapshot,
  serializeGameplaySnapshot,
} from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import { startedGameplayHand } from "./support/gameplay-hand-fixture.js";

describe("gameplay snapshot codec", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("round-trips a versioned %s aggregate snapshot", (profileId) => {
    const aggregate = startedGameplayHand(profileId);
    const record = serializeGameplaySnapshot(aggregate);

    expect(record).toMatchObject({
      ruleProfileId: profileId,
      schemaVersion: 2,
      state: { handNumber: 1, phase: "four-bidding" },
    });
    expect(hydrateGameplaySnapshot(record)).toEqual(aggregate);
  });

  it("does not let hydrated mutations alter the persisted JSON value", () => {
    const record = serializeGameplaySnapshot(startedGameplayHand());
    const hydrated = hydrateGameplaySnapshot(record);
    const firstHand = hydrated.deal.hands[0] as unknown[];

    firstHand.pop();

    expect(hydrateGameplaySnapshot(record).deal.hands[0]).toHaveLength(4);
  });

  it("rejects unsupported snapshot versions", () => {
    expect(() =>
      hydrateGameplaySnapshot({
        ...serializeGameplaySnapshot(startedGameplayHand()),
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
    const record = serializeGameplaySnapshot(startedGameplayHand());
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
