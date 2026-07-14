import { randomUUID } from "node:crypto";
import type { RoomIdentityProvider } from "../../application/room-identity-provider.js";

export class NodeRoomIdentityProvider implements RoomIdentityProvider {
  nextAutomationJobId(): string {
    return randomUUID();
  }

  nextCommandId(): string {
    return randomUUID();
  }

  nextRoomId(): string {
    return randomUUID();
  }
}
