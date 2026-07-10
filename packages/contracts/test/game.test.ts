import { describe, expect, it } from "vitest";
import { GameCommandSchema, VersionedPrivateViewSchema } from "../src/index.js";

describe("GameCommandSchema", () => {
  it("accepts a versioned card-play command", () => {
    expect(
      GameCommandSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        expectedVersion: 14,
        action: {
          type: "PLAY_CARD",
          cardId: "spades-J",
          faceDown: false,
          fromIndicator: false,
        },
      }),
    ).toMatchObject({ expectedVersion: 14, action: { type: "PLAY_CARD" } });
  });

  it("rejects a client-supplied actor seat and malformed command ids", () => {
    expect(() =>
      GameCommandSchema.parse({
        commandId: "not-a-uuid",
        roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        expectedVersion: 0,
        actorSeatIndex: 3,
        action: { type: "PASS_BID" },
      }),
    ).toThrow();
  });
});

describe("VersionedPrivateViewSchema", () => {
  it("requires a monotonic non-negative event version", () => {
    expect(() =>
      VersionedPrivateViewSchema.parse({
        roomId: "bad",
        eventVersion: -1,
        view: {},
      }),
    ).toThrow();
  });
});
