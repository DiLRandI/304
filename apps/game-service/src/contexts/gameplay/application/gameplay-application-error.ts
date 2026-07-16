export type GameplayApplicationErrorKind =
  | "conflict"
  | "forbidden"
  | "internal"
  | "not_found"
  | "unavailable";

function gameplayApplicationErrorKind(
  code: string,
): GameplayApplicationErrorKind {
  if (code === "ROOM_NOT_FOUND") return "not_found";
  if (code === "HOST_REQUIRED" || code === "SEAT_REQUIRED") {
    return "forbidden";
  }
  if (code === "ROOM_RECOVERY_FAILED" || code === "ROOM_UNAVAILABLE") {
    return "unavailable";
  }
  if (code === "ROOM_DATA_INVALID") return "internal";
  return "conflict";
}

export class GameplayApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: GameplayApplicationErrorKind = gameplayApplicationErrorKind(
      code,
    ),
  ) {
    super(message);
    this.name = "GameplayApplicationError";
  }
}
