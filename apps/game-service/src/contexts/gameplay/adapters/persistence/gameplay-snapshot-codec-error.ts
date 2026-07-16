export class GameplaySnapshotCodecError extends Error {
  constructor(
    readonly code:
      | "INVALID_GAMEPLAY_SNAPSHOT"
      | "UNSUPPORTED_GAMEPLAY_SNAPSHOT",
    message: string,
  ) {
    super(message);
    this.name = "GameplaySnapshotCodecError";
  }
}
