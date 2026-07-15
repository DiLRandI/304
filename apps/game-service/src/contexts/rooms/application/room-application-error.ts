export type RoomApplicationErrorKind =
  | "conflict"
  | "forbidden"
  | "internal"
  | "not_found"
  | "unavailable";

function roomApplicationErrorKind(code: string): RoomApplicationErrorKind {
  if (code === "ROOM_NOT_FOUND") return "not_found";
  if (code === "HOST_REQUIRED" || code === "SEAT_REQUIRED") {
    return "forbidden";
  }
  if (code === "ROOM_RECOVERY_FAILED") return "unavailable";
  if (code === "ROOM_DATA_INVALID") return "internal";
  return "conflict";
}

export class RoomApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: RoomApplicationErrorKind = roomApplicationErrorKind(code),
  ) {
    super(message);
    this.name = "RoomApplicationError";
  }
}
