import { randomBytes } from "node:crypto";
import type { RoomInviteCodeProvider } from "../../application/room-invite-code-provider.js";

export class NodeRoomInviteCodeProvider implements RoomInviteCodeProvider {
  next(): string {
    return `304-${randomBytes(16).toString("base64url")}`;
  }
}
