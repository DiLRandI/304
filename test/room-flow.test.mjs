import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./helpers/server.mjs";

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test("quick-practice room starts with one person, three bots, and a private hand", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const guest = await requestJson(`${app.baseUrl}/api/guest-session`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Practice Player" }),
  });
  assert.equal(guest.response.status, 201);

  const sessionHeaders = { "x-session-token": guest.body.sessionToken };
  const room = await requestJson(`${app.baseUrl}/api/rooms`, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({
      visibility: "private",
      tableSizeMode: "classic_4",
      ruleProfileId: "classic_304_4p",
      botDifficulty: "easy",
      humanCount: 1,
      enableSecondBidding: true,
    }),
  });
  assert.equal(room.response.status, 201);

  const started = await requestJson(`${app.baseUrl}/api/rooms/${room.body.roomId}/start`, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.status, "in_hand");
  assert.equal(started.body.seats.filter((seat) => seat.type === "human").length, 1);
  assert.equal(started.body.seats.filter((seat) => seat.type === "bot").length, 3);
  assert.equal(started.body.seatView.hand.length, 4);
  assert.equal(started.body.publicState.seats[1].handSize, 4);
  assert.equal(started.body.publicState.seats[1].hand, undefined);
  assert.ok(Array.isArray(started.body.legalActions));
});
