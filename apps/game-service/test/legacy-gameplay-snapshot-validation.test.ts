import { describe, expect, it } from "vitest";
import { GameplaySnapshotCodecError } from "../src/contexts/gameplay/adapters/persistence/gameplay-snapshot-codec.js";
import { decodeGameplayHand } from "../src/contexts/gameplay/adapters/persistence/legacy-gameplay-snapshot-codec.js";
import {
  legacyLobbyGameplaySnapshot,
  legacyStartedGameplaySnapshot,
} from "./support/legacy-gameplay-snapshot-fixture.js";

describe("legacy gameplay snapshot validation", () => {
  it("rejects lobby snapshots because Room Management owns the lobby", () => {
    expect(() =>
      decodeGameplayHand(legacyLobbyGameplaySnapshot()),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
        "Lobby snapshots do not contain a gameplay hand",
      ),
    );
  });

  it("rejects non-production snapshot versions", () => {
    const record = legacyStartedGameplaySnapshot();

    expect(() =>
      decodeGameplayHand({ ...record, schemaVersion: 2 }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
        "Gameplay compatibility snapshot version is not supported",
      ),
    );
  });

  it("rejects a profile mismatch", () => {
    const record = legacyStartedGameplaySnapshot();

    expect(() =>
      decodeGameplayHand({ ...record, ruleProfileId: "six_304_36" }),
    ).toThrowError(
      new GameplaySnapshotCodecError(
        "INVALID_GAMEPLAY_SNAPSHOT",
        "Gameplay compatibility snapshot state is invalid",
      ),
    );
  });
});
