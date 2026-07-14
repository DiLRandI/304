import { describe, expect, it } from "vitest";
import {
  commandId,
  eventVersion,
  inviteCode,
  playerId,
  roomId,
  seatPosition,
} from "../src/index.js";

const UUID = "9c9c7530-224f-4d5e-b354-1c78df2f063b";

describe("room identity values", () => {
  it("accepts UUID identities at the domain boundary", () => {
    expect(roomId(UUID)).toBe(UUID);
    expect(playerId(UUID)).toBe(UUID);
    expect(commandId(UUID)).toBe(UUID);
  });

  it("accepts the established invite-code format", () => {
    expect(inviteCode("304-AbCdEfGhIjKl_123")).toBe("304-AbCdEfGhIjKl_123");
  });

  it("brands non-negative event versions", () => {
    expect(eventVersion(0)).toBe(0);
    expect(eventVersion(42)).toBe(42);
  });

  it("validates a seat against the room seat count", () => {
    expect(seatPosition(3, 4)).toBe(3);
    expect(() => seatPosition(4, 4)).toThrowError("Invalid seat position");
  });

  it.each([
    [() => roomId("not-a-uuid"), "Invalid room id"],
    [() => playerId("not-a-uuid"), "Invalid player id"],
    [() => commandId("not-a-uuid"), "Invalid command id"],
    [() => inviteCode("304-short"), "Invalid invite code"],
    [() => eventVersion(-1), "Invalid event version"],
  ])("rejects an invalid value", (build, message) => {
    expect(build).toThrowError(message);
  });
});
