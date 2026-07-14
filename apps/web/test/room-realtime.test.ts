import { describe, expect, it } from "vitest";
import {
  parseRealtimeServerMessage,
  toRoomSocketUrl,
} from "../src/features/room/api/room-realtime.js";

const roomProjection = {
  roomId: "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
  inviteCode: "304-abcdefghijkl",
  eventVersion: 1,
  status: "lobby",
  viewerSeatIndex: 0,
  view: {},
};

describe("room realtime boundary", () => {
  it("derives a WebSocket room URL from an HTTPS game-service origin", () => {
    expect(
      toRoomSocketUrl(
        "https://api.example.test",
        "a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
      ),
    ).toBe(
      "wss://api.example.test/v1/realtime/rooms/a0f17a73-c12d-4cbf-9167-09e5a26e73a5",
    );
  });

  it("validates every server message before it reaches the room reducer", () => {
    expect(
      parseRealtimeServerMessage({
        type: "SNAPSHOT",
        projection: roomProjection,
      }),
    ).toMatchObject({ type: "SNAPSHOT", projection: roomProjection });
    expect(() =>
      parseRealtimeServerMessage({
        type: "SNAPSHOT",
        projection: { roomId: "not-a-uuid" },
      }),
    ).toThrow();
  });
});
