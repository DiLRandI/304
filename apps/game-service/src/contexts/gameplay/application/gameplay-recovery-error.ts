export class RecoveryError extends Error {
  constructor(readonly roomId: string) {
    super("Room recovery failed");
  }
}
