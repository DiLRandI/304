export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}
