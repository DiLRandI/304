import type { RoomProjection } from "@three-zero-four/contracts";
import type { AuthenticatedSession } from "../../player-access/application/player-session-ports.js";

export interface RoomProjectionQueries {
  getRoom(
    session: AuthenticatedSession,
    roomReference: string,
  ): Promise<RoomProjection>;
  getSnapshot(
    session: AuthenticatedSession,
    roomId: string,
  ): Promise<RoomProjection>;
}

export interface RoomPresenceRefresher {
  refresh(session: AuthenticatedSession, roomId: string): Promise<void>;
}

export interface GetRoomSnapshotInput {
  readonly roomId: string;
  readonly session: AuthenticatedSession;
}

export interface GetRoomInput {
  readonly roomReference: string;
  readonly session: AuthenticatedSession;
}

export class GetRoomSnapshotHandler {
  constructor(
    private readonly queries: Pick<RoomProjectionQueries, "getSnapshot">,
    private readonly presence: RoomPresenceRefresher,
  ) {}

  async execute(input: GetRoomSnapshotInput): Promise<RoomProjection> {
    await this.presence.refresh(input.session, input.roomId);
    return this.queries.getSnapshot(input.session, input.roomId);
  }
}

export class GetRoomHandler {
  constructor(
    private readonly queries: RoomProjectionQueries,
    private readonly presence: RoomPresenceRefresher,
  ) {}

  async execute(input: GetRoomInput): Promise<RoomProjection> {
    const projection = await this.queries.getRoom(
      input.session,
      input.roomReference,
    );
    if (projection.viewerSeatIndex === null) return projection;
    await this.presence.refresh(input.session, projection.roomId);
    return this.queries.getSnapshot(input.session, projection.roomId);
  }
}
