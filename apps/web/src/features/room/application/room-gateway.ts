import type {
  GameAction,
  RoomExitResponse,
  RoomProjection,
} from "@three-zero-four/contracts";

export interface RoomQueryGateway {
  getRoom(roomReference: string): Promise<RoomProjection>;
  getSnapshot(roomId: string): Promise<RoomProjection>;
}

export interface RoomCommandGateway {
  joinRoom(
    roomReference: string,
    expectedVersion: number,
  ): Promise<RoomProjection>;
  leaveRoom(roomId: string, expectedVersion: number): Promise<RoomExitResponse>;
  startRoom(roomId: string, expectedVersion: number): Promise<RoomProjection>;
  submitCommand(
    roomId: string,
    expectedVersion: number,
    action: GameAction,
  ): Promise<RoomProjection>;
}

export interface RoomRealtimeGateway {
  roomSocketUrl(roomId: string): string;
}

export interface RoomGateway
  extends RoomQueryGateway,
    RoomCommandGateway,
    RoomRealtimeGateway {}
