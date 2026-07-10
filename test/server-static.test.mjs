import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./helpers/server.mjs";

test("serves the game shell and its public static entrypoints", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const root = await fetch(`${app.baseUrl}/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type") || "", /^text\/html/);
  const html = await root.text();
  assert.match(html, /src="\.\/src\/ui\/app\.js\?v=[^"]+"/);
  assert.match(html, /rel="icon" href="\.\/assets\/backs\/svg\/card_back_304_ceylon\.svg"/);
  assert.doesNotMatch(html, /frame-ancestors/);

  const stylesheet = await fetch(`${app.baseUrl}/styles.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type") || "", /^text\/css/);

  const client = await fetch(`${app.baseUrl}/src/ui/app.js`);
  assert.equal(client.status, 200);
  assert.match(client.headers.get("content-type") || "", /^application\/javascript/);
  assert.equal(client.headers.get("cache-control"), "no-cache");
});

test("does not expose private server source as a static asset", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/server.js`);
  assert.equal(response.status, 404);
});
