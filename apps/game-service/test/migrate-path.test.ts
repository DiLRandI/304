import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultMigrationsDir } from "../scripts/migrate.js";

describe("defaultMigrationsDir", () => {
  it("resolves the repository migration directory independently of the package working directory", () => {
    expect(defaultMigrationsDir()).toBe(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../infra/postgres/migrations",
      ),
    );
  });

  it("allows an operator-provided migration directory", () => {
    expect(defaultMigrationsDir("/tmp/game-migrations")).toBe(
      "/tmp/game-migrations",
    );
  });
});
