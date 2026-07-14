export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export { ServiceError as DomainError };
