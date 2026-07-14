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
  assert.match(room.body.inviteCode, /^304-[A-Z0-9]{12}$/);

  const started = await requestJson(`${app.baseUrl}/api/rooms/${room.body.roomId}/start`, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.status, "in_hand");
  assert.match(started.body.publicState.inviteCode, /^304-[A-Z0-9]{12}$/);
  assert.equal(started.body.seats.filter((seat) => seat.type === "human").length, 1);
  assert.equal(started.body.seats.filter((seat) => seat.type === "bot").length, 3);
  assert.equal(started.body.seatView.hand.length, 4);
  assert.equal(started.body.publicState.seats[1].handSize, 4);
  assert.equal(started.body.publicState.seats[1].hand, undefined);
  assert.ok(Array.isArray(started.body.legalActions));
});

test("two human players receive distinct private views and can reconnect to their seats", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const hostSession = await requestJson(`${app.baseUrl}/api/guest-session`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Host" }),
  });
  const guestSession = await requestJson(`${app.baseUrl}/api/guest-session`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Guest" }),
  });
  assert.equal(hostSession.response.status, 201);
  assert.equal(guestSession.response.status, 201);

  const hostHeaders = { "x-session-token": hostSession.body.sessionToken };
  const guestHeaders = { "x-session-token": guestSession.body.sessionToken };
  const room = await requestJson(`${app.baseUrl}/api/rooms`, {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({
      visibility: "private",
      tableSizeMode: "classic_4",
      ruleProfileId: "classic_304_4p",
      botDifficulty: "easy",
      humanCount: 2,
      enableSecondBidding: true,
    }),
  });
  assert.equal(room.response.status, 201);

  const joined = await requestJson(`${app.baseUrl}/api/rooms/${room.body.inviteCode}/join`, {
    method: "POST",
    headers: guestHeaders,
    body: JSON.stringify({ displayName: "Guest" }),
  });
  assert.equal(joined.response.status, 201);
  assert.equal(joined.body.seatIndex, 1);

  const started = await requestJson(`${app.baseUrl}/api/rooms/${room.body.roomId}/start`, {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.seats.filter((seat) => seat.type === "human").length, 2);
  assert.equal(started.body.seats.filter((seat) => seat.type === "bot").length, 2);
  assert.equal(started.body.seatView.hand.length, 4);
  assert.equal(started.body.publicState.seats[1].hand, undefined);

  const newcomerSession = await requestJson(`${app.baseUrl}/api/guest-session`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Late Player" }),
  });
  const lateJoin = await requestJson(`${app.baseUrl}/api/rooms/${room.body.inviteCode}/join`, {
    method: "POST",
    headers: { "x-session-token": newcomerSession.body.sessionToken },
    body: JSON.stringify({ displayName: "Late Player" }),
  });
  assert.equal(lateJoin.response.status, 409);

  const guestState = await requestJson(`${app.baseUrl}/api/rooms/${room.body.roomId}`, {
    headers: guestHeaders,
  });
  assert.equal(guestState.response.status, 200);
  assert.equal(guestState.body.seatIndex, 1);
  assert.equal(guestState.body.seatView.hand.length, 4);
  assert.equal(guestState.body.publicState.seats[0].hand, undefined);

  const rejoined = await requestJson(`${app.baseUrl}/api/rooms/${room.body.inviteCode}/join`, {
    method: "POST",
    headers: guestHeaders,
    body: JSON.stringify({ displayName: "Guest" }),
  });
  assert.equal(rejoined.response.status, 200);
  assert.equal(rejoined.body.seatIndex, 1);
  assert.deepEqual(
    rejoined.body.seatView.hand.map((card) => card.cardId),
    guestState.body.seatView.hand.map((card) => card.cardId),
  );
});

test("room events hide a selected trump indicator from seated opponents", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const sessions = [];
  for (const displayName of ["Host", "North", "East", "West"]) {
    const guest = await requestJson(`${app.baseUrl}/api/guest-session`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    assert.equal(guest.response.status, 201);
    sessions.push({
      displayName,
      headers: { "x-session-token": guest.body.sessionToken },
    });
  }

  const room = await requestJson(`${app.baseUrl}/api/rooms`, {
    method: "POST",
    headers: sessions[0].headers,
    body: JSON.stringify({
      visibility: "private",
      tableSizeMode: "classic_4",
      ruleProfileId: "classic_304_4p",
      botDifficulty: "easy",
      humanCount: 4,
      enableSecondBidding: true,
    }),
  });
  assert.equal(room.response.status, 201);

  const sessionsBySeat = new Map([[0, sessions[0]]]);
  for (const session of sessions.slice(1)) {
    const joined = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.inviteCode}/join`,
      {
        method: "POST",
        headers: session.headers,
        body: JSON.stringify({ displayName: session.displayName }),
      },
    );
    assert.equal(joined.response.status, 201);
    sessionsBySeat.set(joined.body.seatIndex, session);
  }

  let state = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/start`,
    {
      method: "POST",
      headers: sessions[0].headers,
      body: JSON.stringify({}),
    },
  );
  assert.equal(state.response.status, 200);

  while (state.body.phase === "four_bidding") {
    const activeSeat = state.body.publicState.activeSeat;
    const activeSession = sessionsBySeat.get(activeSeat);
    state = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
      { headers: activeSession.headers },
    );
    const action =
      state.body.publicState.bidding.currentBid === 0
        ? state.body.legalActions.find(
            (candidate) =>
              candidate.type === "BID" && candidate.amount === 160,
          )
        : state.body.legalActions.find(
            (candidate) => candidate.type === "PASS_BID",
          );
    assert.ok(action);
    state = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.roomId}/actions`,
      {
        method: "POST",
        headers: activeSession.headers,
        body: JSON.stringify(action),
      },
    );
    assert.equal(state.response.status, 200);
  }

  assert.equal(state.body.phase, "trump_selection");
  const makerSeat = state.body.publicState.activeSeat;
  const makerSession = sessionsBySeat.get(makerSeat);
  state = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
    { headers: makerSession.headers },
  );
  const selectTrump = state.body.legalActions.find(
    (candidate) => candidate.type === "SELECT_TRUMP",
  );
  assert.ok(selectTrump?.cardId);

  const selected = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/actions`,
    {
      method: "POST",
      headers: makerSession.headers,
      body: JSON.stringify(selectTrump),
    },
  );
  assert.equal(selected.response.status, 200);

  const opponentSeats = [...sessionsBySeat.keys()].filter(
    (seat) => seat !== makerSeat,
  );
  const [makerEvents, ...opponentResults] = await Promise.all([
    requestJson(`${app.baseUrl}/api/rooms/${room.body.roomId}/events`, {
      headers: makerSession.headers,
    }),
    ...opponentSeats.map((opponentSeat) =>
      requestJson(`${app.baseUrl}/api/rooms/${room.body.roomId}/events`, {
        headers: sessionsBySeat.get(opponentSeat).headers,
      }),
    ),
  ]);
  assert.equal(makerEvents.response.status, 200);

  const makerSelection = makerEvents.body.events.find(
    (event) => event.type === "TRUMP_SELECTED",
  );
  assert.equal(makerSelection?.payload?.cardId, selectTrump.cardId);

  for (const opponentEvents of opponentResults) {
    assert.equal(opponentEvents.response.status, 200);
    const opponentSelection = opponentEvents.body.events.find(
      (event) => event.type === "TRUMP_SELECTED",
    );
    assert.deepEqual(Object.keys(opponentSelection?.payload || {}).sort(), [
      "seat",
      "source",
    ]);
    assert.equal(opponentSelection?.payload?.seat, makerSeat);
    assert.equal(
      JSON.stringify(opponentEvents.body).includes(selectTrump.cardId),
      false,
    );
  }

  const opponentState = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
    { headers: sessionsBySeat.get(opponentSeats[0]).headers },
  );
  assert.equal(opponentState.response.status, 200);
  assert.equal(
    JSON.stringify(opponentState.body).includes(selectTrump.cardId),
    false,
  );
});

test("completed room responses expose only the public hand result", async (t) => {
  const app = await startServer({ env: { TRICK_REVEAL_DELAY_MS: "25" } });
  t.after(() => app.close());

  const sessions = [];
  for (const displayName of ["Host", "North", "East", "West"]) {
    const guest = await requestJson(`${app.baseUrl}/api/guest-session`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    assert.equal(guest.response.status, 201);
    sessions.push({
      displayName,
      headers: { "x-session-token": guest.body.sessionToken },
    });
  }

  const room = await requestJson(`${app.baseUrl}/api/rooms`, {
    method: "POST",
    headers: sessions[0].headers,
    body: JSON.stringify({
      visibility: "private",
      tableSizeMode: "classic_4",
      ruleProfileId: "classic_304_4p",
      botDifficulty: "easy",
      humanCount: 4,
      enableSecondBidding: true,
    }),
  });
  assert.equal(room.response.status, 201);

  const sessionsBySeat = new Map([[0, sessions[0]]]);
  for (const session of sessions.slice(1)) {
    const joined = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.inviteCode}/join`,
      {
        method: "POST",
        headers: session.headers,
        body: JSON.stringify({ displayName: session.displayName }),
      },
    );
    assert.equal(joined.response.status, 201);
    sessionsBySeat.set(joined.body.seatIndex, session);
  }

  let state = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/start`,
    {
      method: "POST",
      headers: sessions[0].headers,
      body: JSON.stringify({}),
    },
  );
  assert.equal(state.response.status, 200);

  let actionCount = 0;
  while (
    state.body.phase !== "hand_result" &&
    state.body.phase !== "match_complete" &&
    actionCount < 100
  ) {
    if (state.body.phase === "trick_result") {
      const deadline = Date.now() + 1_000;
      do {
        await new Promise((resolve) => setTimeout(resolve, 10));
        state = await requestJson(
          `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
          { headers: sessions[0].headers },
        );
      } while (state.body.phase === "trick_result" && Date.now() < deadline);
      assert.notEqual(state.body.phase, "trick_result");
      continue;
    }
    const activeSeat = state.body.publicState.activeSeat;
    const activeSession = sessionsBySeat.get(activeSeat);
    assert.ok(activeSession, `expected session for active seat ${activeSeat}`);
    state = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
      { headers: activeSession.headers },
    );

    let action;
    if (state.body.phase === "four_bidding") {
      action =
        state.body.publicState.bidding.currentBid === 0
          ? state.body.legalActions.find(
              (candidate) =>
                candidate.type === "BID" && candidate.amount === 160,
            )
          : state.body.legalActions.find(
              (candidate) => candidate.type === "PASS_BID",
            );
    } else if (state.body.phase === "trump_selection") {
      action = state.body.legalActions.find(
        (candidate) => candidate.type === "SELECT_TRUMP",
      );
    } else if (state.body.phase === "second_bidding") {
      action = state.body.legalActions.find(
        (candidate) => candidate.type === "PASS_BID",
      );
    } else if (state.body.phase === "trump_choice") {
      action = state.body.legalActions.find(
        (candidate) => candidate.type === "TRUMP_OPEN",
      );
    } else if (state.body.phase === "trick_play") {
      action = state.body.legalActions.find(
        (candidate) => candidate.type === "PLAY_CARD",
      );
    }
    assert.ok(action, `expected legal action during ${state.body.phase}`);

    state = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.roomId}/actions`,
      {
        method: "POST",
        headers: activeSession.headers,
        body: JSON.stringify(action),
      },
    );
    assert.equal(state.response.status, 200);
    actionCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  assert.equal(state.body.phase, "hand_result");
  assert.deepEqual(state.body.handResult, state.body.publicState.handResult);
  assert.equal(Object.hasOwn(state.body.handResult, "shuffleSeed"), false);
  assert.equal(Object.hasOwn(state.body.handResult, "seedCommit"), false);
  assert.equal(Object.hasOwn(state.body.handResult, "deckVersion"), false);
});

test("legacy debug configuration never exposes engine snapshots", async (t) => {
  const app = await startServer({
    env: { INCLUDE_ENGINE_STATE: "true" },
  });
  t.after(() => app.close());

  const guest = await requestJson(`${app.baseUrl}/api/guest-session`, {
    method: "POST",
    body: JSON.stringify({ displayName: "Snapshot Guard" }),
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

  const started = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/start`,
    {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({}),
    },
  );
  assert.equal(started.response.status, 200);

  const anonymous = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
  );
  assert.equal(anonymous.response.status, 401);

  for (const responseBody of [started.body, anonymous.body]) {
    assert.equal(Object.hasOwn(responseBody, "engineState"), false);
    assert.equal(JSON.stringify(responseBody).includes("handShuffle"), false);
  }
});

test("private room and state reads require an authenticated seated player", async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const [host, outsider] = await Promise.all(
    ["Host", "Outsider"].map((displayName) =>
      requestJson(`${app.baseUrl}/api/guest-session`, {
        method: "POST",
        body: JSON.stringify({ displayName }),
      }),
    ),
  );
  assert.equal(host.response.status, 201);
  assert.equal(outsider.response.status, 201);

  const hostHeaders = { "x-session-token": host.body.sessionToken };
  const outsiderHeaders = { "x-session-token": outsider.body.sessionToken };
  const room = await requestJson(`${app.baseUrl}/api/rooms`, {
    method: "POST",
    headers: hostHeaders,
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

  const paths = [
    `/api/rooms/${room.body.roomId}`,
    `/api/rooms/${room.body.roomId}/state`,
  ];
  for (const path of paths) {
    const anonymous = await requestJson(`${app.baseUrl}${path}`);
    assert.equal(anonymous.response.status, 401);

    const nonMember = await requestJson(`${app.baseUrl}${path}`, {
      headers: outsiderHeaders,
    });
    assert.equal(nonMember.response.status, 403);

    const member = await requestJson(`${app.baseUrl}${path}`, {
      headers: hostHeaders,
    });
    assert.equal(member.response.status, 200);
  }
});

test("an active disconnected player advances through autopilot", async (t) => {
  const app = await startServer({
    env: {
      ROOM_PRESENCE_TIMEOUT_MS: "10000",
      DISCONNECT_GRACE_MS: "5000",
      BOT_THINK_DELAY_EASY_MIN_MS: "300",
      BOT_THINK_DELAY_EASY_MAX_MS: "300",
    },
  });
  t.after(() => app.close());

  const sessions = [];
  for (const displayName of ["Host", "North", "East", "West"]) {
    const guest = await requestJson(`${app.baseUrl}/api/guest-session`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    assert.equal(guest.response.status, 201);
    sessions.push({
      displayName,
      headers: { "x-session-token": guest.body.sessionToken },
    });
  }

  const hostHeaders = sessions[0].headers;
  const room = await requestJson(`${app.baseUrl}/api/rooms`, {
    method: "POST",
    headers: hostHeaders,
    body: JSON.stringify({
      visibility: "private",
      tableSizeMode: "classic_4",
      ruleProfileId: "classic_304_4p",
      botDifficulty: "easy",
      humanCount: 4,
      enableSecondBidding: true,
    }),
  });
  assert.equal(room.response.status, 201);

  const sessionsBySeat = new Map([[0, sessions[0]]]);
  for (const session of sessions.slice(1)) {
    const joined = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.inviteCode}/join`,
      {
        method: "POST",
        headers: session.headers,
        body: JSON.stringify({ displayName: session.displayName }),
      },
    );
    assert.equal(joined.response.status, 201);
    sessionsBySeat.set(joined.body.seatIndex, session);
  }

  let state = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/start`,
    {
      method: "POST",
      headers: hostHeaders,
      body: JSON.stringify({}),
    },
  );
  assert.equal(state.response.status, 200);

  while (state.body.publicState.activeSeat !== 0) {
    const activeSeat = state.body.publicState.activeSeat;
    const activeSession = sessionsBySeat.get(activeSeat);
    const current = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
      { headers: activeSession.headers },
    );
    const action =
      current.body.publicState.bidding.currentBid === 0
        ? current.body.legalActions.find(
            (candidate) =>
              candidate.type === "BID" && candidate.amount === 160,
          )
        : current.body.legalActions.find(
            (candidate) => candidate.type === "PASS_BID",
          );
    assert.ok(action);
    state = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.roomId}/actions`,
      {
        method: "POST",
        headers: activeSession.headers,
        body: JSON.stringify(action),
      },
    );
    assert.equal(state.response.status, 200);
  }

  const hostTurn = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
    { headers: hostHeaders },
  );
  const hostAction = hostTurn.body.legalActions.find(
    (candidate) => candidate.type === "PASS_BID",
  );
  assert.ok(hostAction);
  state = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/actions`,
    {
      method: "POST",
      headers: hostHeaders,
      body: JSON.stringify(hostAction),
    },
  );
  assert.equal(state.response.status, 200);

  const autopilotSeat = state.body.publicState.activeSeat;
  assert.notEqual(autopilotSeat, 0);
  const versionBeforeAutopilot = state.body.version;

  await new Promise((resolve) => setTimeout(resolve, 10_100));
  const disconnected = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
    { headers: hostHeaders },
  );
  assert.equal(disconnected.response.status, 200);
  assert.equal(
    disconnected.body.publicState.seats[autopilotSeat].connectionStatus,
    "disconnected",
  );

  await new Promise((resolve) => setTimeout(resolve, 5_100));
  const autopilotTriggered = await requestJson(
    `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
    { headers: hostHeaders },
  );
  assert.equal(autopilotTriggered.response.status, 200);

  let advanced;
  const advanceDeadline = Date.now() + 5_000;
  do {
    advanced = await requestJson(
      `${app.baseUrl}/api/rooms/${room.body.roomId}/state`,
      { headers: hostHeaders },
    );
    if (
      advanced.body.version > versionBeforeAutopilot &&
      advanced.body.publicState.seats[autopilotSeat].reconnectSummary.length > 0
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < advanceDeadline);

  assert.equal(advanced.response.status, 200);
  assert.ok(advanced.body.version > versionBeforeAutopilot);
  assert.ok(
    advanced.body.publicState.seats[autopilotSeat].reconnectSummary.length > 0,
  );
});
