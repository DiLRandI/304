declare const roomBrand: unique symbol;

type RoomValue<Value, Name extends string> = Value & {
  readonly [roomBrand]: Name;
};

export type CommandId = RoomValue<string, "CommandId">;
export type EventVersion = RoomValue<number, "EventVersion">;
export type InviteCode = RoomValue<string, "InviteCode">;
export type PlayerId = RoomValue<string, "PlayerId">;
export type RoomId = RoomValue<string, "RoomId">;
export type SeatPosition = RoomValue<number, "SeatPosition">;

export class InvalidRoomValue extends Error {
  constructor(
    readonly code:
      | "INVALID_COMMAND_ID"
      | "INVALID_EVENT_VERSION"
      | "INVALID_INVITE_CODE"
      | "INVALID_PLAYER_ID"
      | "INVALID_ROOM_ID"
      | "INVALID_SEAT_POSITION",
    message: string,
  ) {
    super(message);
    this.name = "InvalidRoomValue";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid<Value>(
  value: string,
  code: InvalidRoomValue["code"],
  message: string,
): Value {
  if (!uuidPattern.test(value)) throw new InvalidRoomValue(code, message);
  return value as Value;
}

export function roomId(value: string): RoomId {
  return uuid<RoomId>(value, "INVALID_ROOM_ID", "Invalid room id");
}

export function playerId(value: string): PlayerId {
  return uuid<PlayerId>(value, "INVALID_PLAYER_ID", "Invalid player id");
}

export function commandId(value: string): CommandId {
  return uuid<CommandId>(value, "INVALID_COMMAND_ID", "Invalid command id");
}

export function inviteCode(value: string): InviteCode {
  if (!/^304-[A-Za-z0-9_-]{12,32}$/.test(value)) {
    throw new InvalidRoomValue("INVALID_INVITE_CODE", "Invalid invite code");
  }
  return value as InviteCode;
}

export function eventVersion(value: number): EventVersion {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidRoomValue(
      "INVALID_EVENT_VERSION",
      "Invalid event version",
    );
  }
  return value as EventVersion;
}

export function seatPosition(value: number, seatCount: number): SeatPosition {
  if (
    !Number.isInteger(value) ||
    !Number.isInteger(seatCount) ||
    seatCount < 1 ||
    value < 0 ||
    value >= seatCount
  ) {
    throw new InvalidRoomValue(
      "INVALID_SEAT_POSITION",
      "Invalid seat position",
    );
  }
  return value as SeatPosition;
}
