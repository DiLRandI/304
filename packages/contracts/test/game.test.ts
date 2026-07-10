import { describe, expect, it } from "vitest";
import {
  CreateRoomRequestSchema,
  GameCommandSchema,
  JoinRoomRequestSchema,
  RealtimeClientMessageSchema,
  RealtimeServerMessageSchema,
  RoomProjectionSchema,
  RuleProfileIdSchema,
  VersionedPrivateViewSchema,
} from "../src/index.js";

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

describe("durable room request contracts", () => {
  it("accepts only the two durable room profiles", () => {
    expect(
      CreateRoomRequestSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        ruleProfileId: "classic_304_4p",
      }),
    ).toMatchObject({ ruleProfileId: "classic_304_4p" });
    expect(
      CreateRoomRequestSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        ruleProfileId: "six_304_36",
      }),
    ).toMatchObject({ ruleProfileId: "six_304_36" });
    expect(() =>
      JoinRoomRequestSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        expectedVersion: 1,
        actorSeatIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      RoomProjectionSchema.parse({ roomId: "bad", eventVersion: -1 }),
    ).toThrow();
  });
});

describe("realtime message contracts", () => {
  it("defines the supported profile vocabulary without exposing an unfinished room mode", () => {
    expect(RuleProfileIdSchema.parse("six_304_36")).toBe("six_304_36");
    expect(() => RuleProfileIdSchema.parse("custom_304")).toThrow();
  });

  it("accepts only strict heartbeat and resynchronization requests", () => {
    expect(RealtimeClientMessageSchema.parse({ type: "PING" })).toEqual({
      type: "PING",
    });
    expect(() =>
      RealtimeClientMessageSchema.parse({
        type: "RESYNC",
        roomId: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      RealtimeClientMessageSchema.parse({ type: "PING", actorSeatIndex: 3 }),
    ).toThrow();
  });

  it("carries a private six-seat snapshot only in a valid server envelope", () => {
    expect(
      RealtimeServerMessageSchema.parse({
        type: "SNAPSHOT",
        projection: {
          roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
          inviteCode: "304-abcdefghijkl",
          eventVersion: 7,
          status: "in_hand",
          viewerSeatIndex: 5,
          view: {},
        },
      }),
    ).toMatchObject({
      type: "SNAPSHOT",
      projection: { viewerSeatIndex: 5 },
    });
    expect(() =>
      RealtimeServerMessageSchema.parse({
        type: "SNAPSHOT",
        projection: { roomId: "bad" },
      }),
    ).toThrow();
  });
});
