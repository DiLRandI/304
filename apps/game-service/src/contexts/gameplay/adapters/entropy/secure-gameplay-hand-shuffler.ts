import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  buildDeck,
  type RandomSource,
  type RuleProfile,
  shuffleDeck,
} from "@three-zero-four/gameplay";
import type {
  GameplayHandShuffler,
  PreparedGameplayHandDeck,
} from "../../application/gameplay-hand-shuffler.js";

type ShuffleSeedSource = () => string;

function secureSeed(): string {
  return `s_${randomBytes(32).toString("hex")}`;
}

function seededRandom(seed: string): RandomSource {
  const key = Buffer.from(seed);
  let block = Buffer.alloc(0);
  let counter = 0;
  let offset = 0;

  return {
    next(): number {
      if (offset + 4 > block.length) {
        const nonce = Buffer.alloc(8);
        nonce.writeBigUInt64BE(BigInt(counter));
        counter += 1;
        block = createHmac("sha256", key).update(nonce).digest();
        offset = 0;
      }
      const value = block.readUInt32BE(offset);
      offset += 4;
      return value / 4_294_967_296;
    },
  };
}

export class SecureGameplayHandShuffler implements GameplayHandShuffler {
  constructor(private readonly nextSeed: ShuffleSeedSource = secureSeed) {}

  prepare(profile: RuleProfile, handNumber: number): PreparedGameplayHandDeck {
    const seed = this.nextSeed();
    const commitment = `c_${createHash("sha256")
      .update(`${seed}|${profile.id}|${handNumber}`)
      .digest("hex")}`;
    return {
      audit: { algorithm: "hmac-sha256-v1", commitment, seed },
      deck: shuffleDeck(buildDeck(profile), seededRandom(seed)),
    };
  }
}
