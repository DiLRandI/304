import { describe, expect, it } from "vitest";
import {
  GameplaySnapshotCodecError,
  hydrateGameplaySnapshot,
  serializeGameplaySnapshot,
} from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import {
  completedGameplayHand,
  startedGameplayHand,
} from "./support/gameplay-hand-fixture.js";
import { legacyStartedGameplaySnapshot } from "./support/legacy-gameplay-snapshot-fixture.js";

describe("gameplay snapshot codec", () => {
  it.each([
    "classic_304_4p",
    "six_304_36",
  ] as const)("round-trips a versioned %s aggregate snapshot", (profileId) => {
    const aggregate = startedGameplayHand(profileId, true, true);
    const record = serializeGameplaySnapshot(aggregate);

    expect(record).toMatchObject({
      ruleProfileId: profileId,
      schemaVersion: 3,
      state: {
        endHandWhenOutcomeCertain: true,
        handNumber: 1,
        phase: "four-bidding",
      },
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
        schemaVersion: 4,
      }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
        "Gameplay snapshot version is not supported",
      ),
    );
  });

  it("hydrates v1 and v2 snapshots with early settlement disabled", () => {
    const current = serializeGameplaySnapshot(
      startedGameplayHand("classic_304_4p", true, true),
    );
    const { endHandWhenOutcomeCertain: _setting, ...v2State } =
      current.state as typeof current.state & {
        endHandWhenOutcomeCertain: boolean;
      };

    expect(
      hydrateGameplaySnapshot({
        ...current,
        schemaVersion: 2,
        state: v2State,
      }).endHandWhenOutcomeCertain,
    ).toBe(false);
    expect(
      hydrateGameplaySnapshot(legacyStartedGameplaySnapshot())
        .endHandWhenOutcomeCertain,
    ).toBe(false);
  });

  it("hydrates a scored v2 result as all tricks played", () => {
    const current = serializeGameplaySnapshot(completedGameplayHand());
    const {
      endHandWhenOutcomeCertain: _setting,
      result,
      ...rest
    } = current.state as GameplayHandState;
    if (!result || "noScore" in result) {
      throw new Error("Expected a scored hand result");
    }
    const { settlementReason: _reason, ...v2Result } = result;

    expect(
      hydrateGameplaySnapshot({
        ...current,
        schemaVersion: 2,
        state: { ...rest, result: v2Result },
      }).result,
    ).toMatchObject({ settlementReason: "all-tricks-played" });
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

type GameplayHandState = Omit<
  ReturnType<typeof completedGameplayHand>,
  "profile"
>;
