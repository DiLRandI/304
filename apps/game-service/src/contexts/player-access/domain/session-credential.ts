const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionCredential {
  readonly secret: string;
  readonly sessionId: string;
}

export function parseSessionCredential(
  value: string | undefined,
): SessionCredential | null {
  const parts = value?.split(".");
  if (parts?.length !== 2) return null;
  const [sessionId, secret] = parts;
  if (
    !sessionId ||
    !secret ||
    !UUID_PATTERN.test(sessionId) ||
    !SECRET_PATTERN.test(secret)
  ) {
    return null;
  }
  return { secret, sessionId };
}

export function formatSessionCredential(credential: SessionCredential): string {
  return `${credential.sessionId}.${credential.secret}`;
}
