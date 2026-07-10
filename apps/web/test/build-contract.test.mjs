import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("web shell declares an explicitly configured game API origin", () => {
  const page = fs.readFileSync(
    new URL("../src/app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /NEXT_PUBLIC_GAME_SERVICE_URL/);
  assert.doesNotMatch(page, /localhost:4100/);
});

test("web shell includes an application icon", () => {
  assert.ok(fs.existsSync(new URL("../src/app/icon.svg", import.meta.url)));
});
