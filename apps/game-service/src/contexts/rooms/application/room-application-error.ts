export class RoomApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RoomApplicationError";
  }
}
