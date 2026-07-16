const MAX_DISPLAY_NAME_LENGTH = 48;

export class InvalidDisplayNameError extends Error {
  constructor() {
    super("Display name is invalid");
    this.name = "InvalidDisplayNameError";
  }
}

export function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new InvalidDisplayNameError();
  }
  return normalized;
}
