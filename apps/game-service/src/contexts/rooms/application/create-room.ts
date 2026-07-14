import {
  type CommandId,
  createLobby,
  inviteCode,
  projectRoom,
  type Room,
  type RoomPlayer,
  type RoomProjection,
  type RoomRuleProfileId,
  type RoomSettings,
  roomId,
} from "@three-zero-four/room-domain";
import type { RoomPresence } from "./room-command-ports.js";
import type { RoomIdentityProvider } from "./room-identity-provider.js";
import type { RoomInviteCodeProvider } from "./room-invite-code-provider.js";

export interface CreateRoomInput {
  readonly commandId: CommandId;
  readonly host: RoomPlayer;
  readonly profileId: RoomRuleProfileId;
  readonly sessionId: string;
  readonly settings: RoomSettings;
}

export interface RoomCreationCommit {
  readonly commandId: CommandId;
  readonly response: RoomProjection;
  readonly room: Room;
  readonly sessionId: string;
}

export interface RoomCreationRepository {
  create(commit: RoomCreationCommit): Promise<void>;
  findDuplicate(
    sessionId: string,
    commandId: CommandId,
  ): Promise<RoomProjection | null>;
}

export class CreateRoomHandler {
  constructor(
    private readonly repository: RoomCreationRepository,
    private readonly presence: RoomPresence,
    private readonly identities: Pick<RoomIdentityProvider, "nextRoomId">,
    private readonly inviteCodes: RoomInviteCodeProvider,
  ) {}

  async execute(input: CreateRoomInput): Promise<RoomProjection> {
    const duplicate = await this.repository.findDuplicate(
      input.sessionId,
      input.commandId,
    );
    if (duplicate) {
      await this.presence.touch(duplicate.id, input.host.playerId);
      return duplicate;
    }
    const room = createLobby({
      host: input.host,
      id: roomId(this.identities.nextRoomId()),
      inviteCode: inviteCode(this.inviteCodes.next()),
      profileId: input.profileId,
      settings: input.settings,
    });
    const response = projectRoom(room, input.host.playerId);
    await this.repository.create({
      commandId: input.commandId,
      response,
      room,
      sessionId: input.sessionId,
    });
    await this.presence.touch(response.id, input.host.playerId);
    return response;
  }
}
