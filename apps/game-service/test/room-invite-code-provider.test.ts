import { describe, expect, it } from "vitest";
import { NodeRoomInviteCodeProvider } from "../src/contexts/rooms/adapters/security/node-room-invite-code-provider.js";

describe("NodeRoomInviteCodeProvider", () => {
  it("creates opaque URL-safe room invite codes", () => {
    const provider = new NodeRoomInviteCodeProvider();

    const first = provider.next();
    const second = provider.next();

    expect(first).toMatch(/^304-[A-Za-z0-9_-]{22}$/);
    expect(second).toMatch(/^304-[A-Za-z0-9_-]{22}$/);
    expect(second).not.toBe(first);
  });
});
