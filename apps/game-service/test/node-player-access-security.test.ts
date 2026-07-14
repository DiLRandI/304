import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  NodeSessionSecrets,
  UuidIdentityProvider,
} from "../src/contexts/player-access/adapters/security/node-player-access-security.js";
import { parseSessionCredential } from "../src/contexts/player-access/domain/session-credential.js";

describe("Node player access security", () => {
  it("provides UUID identities", () => {
    const identity = new UuidIdentityProvider().next();
    expect(identity).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generates credential-safe secrets", () => {
    const secret = new NodeSessionSecrets("test-pepper").generate();
    const sessionId = "b8fc339d-ee47-45f9-826c-b3477bdb8d51";

    expect(secret).toHaveLength(43);
    expect(parseSessionCredential(`${sessionId}.${secret}`)).toEqual({
      secret,
      sessionId,
    });
  });

  it("creates a peppered SHA-256 digest", () => {
    const pepper = "test-pepper";
    const secret = "opaque-secret";
    const expected = createHmac("sha256", pepper).update(secret).digest("hex");

    expect(new NodeSessionSecrets(pepper).digest(secret)).toBe(expected);
  });

  it("verifies matching digests without accepting malformed or wrong values", () => {
    const secrets = new NodeSessionSecrets("test-pepper");
    const digest = secrets.digest("expected-secret");

    expect(secrets.matches("expected-secret", digest)).toBe(true);
    expect(secrets.matches("wrong-secret", digest)).toBe(false);
    expect(secrets.matches("expected-secret", "not-a-hex-digest")).toBe(false);
  });
});
