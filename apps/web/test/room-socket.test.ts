import { describe, expect, it } from "vitest";
import { encodeRoomClientMessage } from "../src/features/room/api/room-socket.js";

describe("room socket adapter", () => {
  it("encodes only validated realtime client messages", () => {
    expect(encodeRoomClientMessage({ type: "PING" })).toBe(
      JSON.stringify({ type: "PING" }),
    );
    expect(() => encodeRoomClientMessage({ type: "ADMIN" })).toThrow();
  });
});
