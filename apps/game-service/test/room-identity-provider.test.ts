import { describe, expect, it } from "vitest";
import { NodeRoomIdentityProvider } from "../src/contexts/rooms/adapters/security/node-room-identity-provider.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("NodeRoomIdentityProvider", () => {
  it("creates distinct UUIDs for every room identity purpose", () => {
    const provider = new NodeRoomIdentityProvider();
    const identities = [
      provider.nextRoomId(),
      provider.nextCommandId(),
      provider.nextAutomationJobId(),
    ];

    expect(identities).toHaveLength(new Set(identities).size);
    for (const identity of identities) expect(identity).toMatch(uuidPattern);
  });
});
