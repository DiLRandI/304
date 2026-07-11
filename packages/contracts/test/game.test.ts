import { describe, expect, it } from "vitest";
import {
  CreateRoomRequestSchema,
  GameCommandSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  RealtimeClientMessageSchema,
  RealtimeServerMessageSchema,
  RoomExitResponseSchema,
  RoomProjectionSchema,
  RuleProfileIdSchema,
  ServiceErrorResponseSchema,
  SessionResponseSchema,
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

  it("accepts only versioned room-leave requests and safe exit responses", () => {
    expect(
      LeaveRoomRequestSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        expectedVersion: 7,
      }),
    ).toEqual({
      commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      expectedVersion: 7,
    });
    expect(() =>
      LeaveRoomRequestSchema.parse({
        actorPlayerId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        expectedVersion: 7,
      }),
    ).toThrow();
    expect(
      RoomExitResponseSchema.parse({
        eventVersion: 8,
        roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        status: "left",
      }),
    ).toEqual({
      eventVersion: 8,
      roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
      status: "left",
    });
    expect(() =>
      RoomExitResponseSchema.parse({
        eventVersion: 8,
        roomId: "b4203a72-1ddb-421f-81af-e52ca7b7003c",
        status: "left",
        view: {},
      }),
    ).toThrow();
  });

  it("accepts a bounded bot difficulty and defaults it for compatibility", () => {
    expect(
      CreateRoomRequestSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        ruleProfileId: "six_304_36",
        botDifficulty: "strong",
      }),
    ).toMatchObject({ botDifficulty: "strong" });
    expect(
      CreateRoomRequestSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      }),
    ).toMatchObject({ botDifficulty: "easy" });
    expect(() =>
      CreateRoomRequestSchema.parse({
        commandId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
        botDifficulty: "unlimited",
      }),
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

describe("browser service response contracts", () => {
  it("accepts a bounded session response and rejects malformed identity data", () => {
    expect(
      SessionResponseSchema.parse({
        player: {
          id: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
          displayName: "Asha",
        },
        expiresAt: "2026-07-11T12:00:00.000Z",
      }),
    ).toMatchObject({ player: { displayName: "Asha" } });
    expect(() =>
      SessionResponseSchema.parse({
        player: { id: "not-a-uuid", displayName: "Asha" },
        expiresAt: "not-a-timestamp",
      }),
    ).toThrow();
  });

  it("accepts only the safe public service error envelope", () => {
    expect(
      ServiceErrorResponseSchema.parse({
        error: { code: "ROOM_FULL", message: "Room is full" },
      }),
    ).toEqual({ error: { code: "ROOM_FULL", message: "Room is full" } });
    expect(() =>
      ServiceErrorResponseSchema.parse({
        error: { code: "ROOM_FULL", message: "Room is full", stack: "secret" },
      }),
    ).toThrow();
  });
});
