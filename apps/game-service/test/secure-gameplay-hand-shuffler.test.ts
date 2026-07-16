import { createHash } from "node:crypto";
import { getRuleProfile } from "@three-zero-four/gameplay";
import { describe, expect, it } from "vitest";
import { SecureGameplayHandShuffler } from "../src/contexts/gameplay/adapters/entropy/secure-gameplay-hand-shuffler.js";

describe("SecureGameplayHandShuffler", () => {
  it("prepares a deterministic auditable deck from an injected seed", () => {
    const seed = "s_test-seed";
    const profile = getRuleProfile("classic_304_4p");
    const shuffler = new SecureGameplayHandShuffler(() => seed);

    const first = shuffler.prepare(profile, 2);
    const second = shuffler.prepare(profile, 2);

    expect(first).toEqual(second);
    expect(first.deck).toHaveLength(32);
    expect(new Set(first.deck.map((card) => card.id)).size).toBe(32);
    expect(first.audit).toEqual({
      algorithm: "hmac-sha256-v1",
      commitment: `c_${createHash("sha256")
        .update(`${seed}|classic_304_4p|2`)
        .digest("hex")}`,
      seed,
    });
  });
});
