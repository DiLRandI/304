import { randomBytes, randomUUID } from "node:crypto";
import type { TournamentIdentityProvider } from "../../application/create-tournament.js";

export class NodeTournamentIdentityProvider
  implements TournamentIdentityProvider
{
  id(): string {
    return randomUUID();
  }

  slug(name: string): string {
    const prefix = name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase("en")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 64);
    return `${prefix || "tournament"}-${randomBytes(4).toString("hex")}`;
  }
}
