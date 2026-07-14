export class SessionRequiredError extends Error {
  constructor() {
    super("A guest session is required");
    this.name = "SessionRequiredError";
  }
}
