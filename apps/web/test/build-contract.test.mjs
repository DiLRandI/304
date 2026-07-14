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

test("public pages remain eligible for static prerendering", () => {
  const publicPages = [
    "../src/app/page.tsx",
    "../src/app/play/page.tsx",
    "../src/app/privacy/page.tsx",
    "../src/app/rules/page.tsx",
    "../src/app/terms/page.tsx",
  ];

  for (const pagePath of publicPages) {
    const page = fs.readFileSync(new URL(pagePath, import.meta.url), "utf8");
    assert.doesNotMatch(page, /dynamic\s*=\s*["']force-dynamic["']/);
  }
});

test("web production image builds its workspace contracts before Next.js", () => {
  const dockerfile = fs.readFileSync(
    new URL("../Dockerfile", import.meta.url),
    "utf8",
  );

  assert.match(
    dockerfile,
    /RUN pnpm --filter @three-zero-four\/contracts build\s+RUN pnpm --filter @three-zero-four\/web build/,
  );
});
