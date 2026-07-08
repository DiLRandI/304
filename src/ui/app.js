const setupForm = document.getElementById("setup-form");
const setupPanel = document.getElementById("setup-panel");
const lobbyPanel = document.getElementById("lobby-panel");
const gamePanel = document.getElementById("game-panel");

const roomCode = document.getElementById("room-code");
const roomLink = document.getElementById("room-link");
const lobbySeats = document.getElementById("lobby-seats");
const lobbyHint = document.getElementById("lobby-hint");

const startMatchBtn = document.getElementById("start-match-btn");
const createNewBtn = document.getElementById("create-new-btn");
const quickPlayBtn = document.getElementById("quick-play-btn");

const gameMessage = document.getElementById("game-message");
const matchBoard = document.getElementById("match-board");
const scoreboard = document.getElementById("scoreboard");
const trumpArea = document.getElementById("trump-area");
const trickArea = document.getElementById("trick-area");
const handAuditArea = document.getElementById("hand-audit");
const bidHistoryArea = document.getElementById("bid-history");
const previousTrickArea = document.getElementById("previous-trick");
const myHandArea = document.getElementById("my-hand-area");
const actionsArea = document.getElementById("actions");
const resultSummary = document.getElementById("result-summary");
const promptLine = document.getElementById("prompt");

const playerNameInput = document.getElementById("player-name");
const joinRoomInput = document.getElementById("join-room-code");

const ruleProfilesSelect = document.getElementById("rule-profile");
const SESSION_STORAGE_KEY = "304-game-session-v1";
const POLL_INTERVAL_MS = 1500;

let sessionState = null;
let roomState = null;
let pollTimer = null;
let requestInFlight = false;
let autoJoinInProgress = false;

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text ? text : fallback;
}

function normalizeDisplayName(value) {
  const text = normalizeText(value, "Guest");
  return text.slice(0, 24);
}

function normalizeRoomCode(value) {
  return normalizeText(value, "").toUpperCase();
}

function isRoomCode(value) {
  return /^304-[A-Z0-9]{4}$/.test(normalizeRoomCode(value));
}

function formatSeatStatusLabel(seat) {
  if (!seat) return "Disconnected";
  if (seat.autopilot || seat.connectionStatus === "autopilot") {
    return "Autopilot";
  }
  const status = String(seat.connectionStatus || "disconnected").toLowerCase();
  if (status === "online") return "Online";
  return status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}` : "Disconnected";
}

function formatAutopilotAction(action = {}) {
  if (!action?.type) return "";
  if (action.type === "PLAY_CARD") {
    if (action.cardId === "__trump_indicator__") {
      return "played trump indicator";
    }
    return `played ${action.cardId}${action.faceDown ? " (hidden)" : ""}`;
  }
  if (action.type === "BID") return `bid ${action.amount}`;
  if (action.type === "PASS_BID") return "passed bid";
  if (action.type === "SELECT_TRUMP") return "selected trump";
  if (action.type === "TRUMP_OPEN") return "opened trump";
  if (action.type === "TRUMP_CLOSE") return "closed trump";
  return action.type.toLowerCase().replace(/_/g, " ");
}

function loadStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.sessionToken || !parsed.userId) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function saveSession(state) {
  if (!state?.sessionToken) return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // optional storage
  }
}

function persistRoomContext(room) {
  if (!sessionState || !room?.inviteCode) return;
  sessionState.lastRoomId = room.roomId || sessionState.lastRoomId;
  sessionState.lastRoomCode = room.inviteCode;
  saveSession(sessionState);
}

function setStatus(message = "") {
  gameMessage.textContent = message;
}

function setRequestBusy(isBusy) {
  requestInFlight = isBusy;
  const actionButtons = actionsArea.querySelectorAll("button");
  for (const button of actionButtons) {
    button.disabled = isBusy;
  }
  if (roomState?.publicState && roomState.seatIndex == null) {
    for (const button of actionButtons) {
      button.disabled = true;
    }
  }
}

function getSessionHeader() {
  return sessionState?.sessionToken ? { "x-session-token": sessionState.sessionToken } : {};
}

async function apiRequest(path, options = {}) {
  const { method = "GET", body } = options;
  const headers = {
    "content-type": "application/json",
    ...getSessionHeader(),
  };
  const response = await fetch(path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.error || response.statusText || "Request failed";
    const err = new Error(message);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function ensureSession(displayName = "Guest") {
  if (sessionState?.sessionToken) {
    return sessionState;
  }

  const stored = loadStoredSession();
  if (stored?.sessionToken) {
    sessionState = stored;
    playerNameInput.value = normalizeDisplayName(sessionState.displayName, stored.displayName);
    return sessionState;
  }

  const created = await apiRequest("/api/guest-session", {
    method: "POST",
    body: { displayName: normalizeDisplayName(displayName, "Guest") },
  });

  sessionState = created;
  saveSession(created);
  playerNameInput.value = normalizeDisplayName(created.displayName, "Guest");
  return sessionState;
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling() {
  stopPolling();
  if (!roomState?.roomId) return;

  pollTimer = window.setInterval(() => {
    void refreshRoomState();
  }, POLL_INTERVAL_MS);
}

async function refreshRoomState() {
  if (!roomState?.roomId) return;
  if (requestInFlight) return;

  try {
    roomState = await apiRequest(`/api/rooms/${encodeURIComponent(roomState.roomId)}`, {
      method: "GET",
    });
    renderCurrentView();
  } catch (error) {
    if (error.status === 401 || error.status === 404 || error.status === 410) {
      stopPolling();
      roomState = null;
      renderCurrentView();
      setStatus("Session ended or room is no longer available.");
    }
  }
}

function getMySeatIndexFromState(state) {
  if (typeof roomState?.seatIndex === "number") return roomState.seatIndex;
  const me = state?.seats?.find((seat) => seat.isMe);
  return typeof me?.index === "number" ? me.index : null;
}

function renderSeatTile(seat, activeSeat) {
  const card = document.createElement("div");
  card.className = `seat seat-team-${String(seat.team || "A").toLowerCase()} seat-${seat.type}`;
  if (seat.index === activeSeat) {
    card.classList.add("active");
  }

  const header = document.createElement("h3");
  header.textContent = `${normalizeText(seat.displayName, "Guest")}`;
  card.appendChild(header);

  const seatLine = document.createElement("p");
  seatLine.textContent = `${seat.type.toUpperCase()} • ${seat.team} • Seat ${seat.index}`;
  card.appendChild(seatLine);

  const handLine = document.createElement("p");
  handLine.textContent = `Hand: ${seat.handSize || 0} cards`;
  card.appendChild(handLine);

  const statusLine = document.createElement("p");
  statusLine.textContent = `Status: ${formatSeatStatusLabel(seat)}`;
  card.appendChild(statusLine);
  if (seat.autopilot && seat.connectionStatus === "autopilot" && Array.isArray(seat.reconnectSummary) && seat.reconnectSummary.length > 0) {
    const summaryLine = document.createElement("p");
    const summary = seat.reconnectSummary.slice(-2).map((action) => formatAutopilotAction(action)).filter(Boolean);
    summaryLine.textContent = `Autopilot actions: ${summary.length ? summary.join(", ") : "Waiting..."}`;
    card.appendChild(summaryLine);
  }

  if (seat.autopilot && seat.connectionStatus === "autopilot") {
    card.classList.add("seat-autopilot");
  }

  if (seat.isMe) {
    const mine = document.createElement("p");
    mine.textContent = "You";
    card.appendChild(mine);
  }

  if (roomState?.status === "lobby") {
    const seatAction = document.createElement("button");
    seatAction.type = "button";
    seatAction.className = "seat-action";
    seatAction.disabled = !sessionState?.sessionToken;

    if (seat.isMe) {
      seatAction.textContent = "Your seat";
      seatAction.disabled = true;
    } else if (seat.type === "human") {
      seatAction.textContent = "Occupied";
      seatAction.disabled = true;
    } else if (seat.type === "empty") {
      seatAction.textContent = "Take this seat";
    } else {
      seatAction.textContent = "Replace bot";
    }
    if (!seat.isMe && !seatAction.disabled) {
      seatAction.addEventListener("click", () => {
        void changeSeat(seat.index);
      });
    }
    card.appendChild(seatAction);

    if (seat.isMe) {
      const readyAction = document.createElement("button");
      readyAction.type = "button";
      readyAction.className = "seat-action";
      readyAction.textContent = seat.isReady ? "Ready" : "Not ready";
      readyAction.setAttribute("aria-label", seat.isReady ? "You are ready" : "You are not ready");
      readyAction.addEventListener("click", () => {
        void setSeatReady(!seat.isReady);
      });
      card.appendChild(readyAction);
    }
  }

  return card;
}

function renderPromptLine(state) {
  const viewerSeat = getMySeatIndexFromState(state);
  const activeSeat = state?.activeSeat;
  const phase = state?.phase || "setup";
  const messages = [`Phase: ${phase.replaceAll("_", " ")}`];

  if (phase === "four_bidding" || phase === "second_bidding") {
    messages.push(`Current bid: ${state.bidding?.currentBid || 0}`);
  }

  if (phase === "trump_selection") {
    messages.push("Select trump from your eligible cards.");
  }

  if (phase === "trump_choice") {
    messages.push("Choose open or closed trump.");
  }

  if (phase === "trick_play") {
    if (activeSeat == null) {
      messages.push("Waiting for trick resolution.");
    } else if (viewerSeat === activeSeat) {
      messages.push("Your turn to play.");
    } else {
      messages.push(`Seat ${activeSeat} to play.`);
    }
  }

  if (state.trump?.suit) {
    const showTrump = state.trump.isOpen || viewerSeat === state.trump.maker;
    messages.push(
      showTrump
        ? `Trump: ${state.trump.suit} (${state.trump.isOpen ? "open" : "closed"})`
        : "Trump is hidden.",
    );
  }

  if (phase === "hand_result" || phase === "match_complete") {
    const pointsByTeam = state.seats.reduce(
      (acc, seat) => {
        acc[seat.team] += seat.trickPoints || 0;
        return acc;
      },
      { A: 0, B: 0 },
    );
    messages.push(`Hand points: A ${pointsByTeam.A} | B ${pointsByTeam.B}`);
  }

  promptLine.textContent = messages.join(" | ");
}

function renderTrick(state) {
  trickArea.textContent = "";
  const heading = document.createElement("h3");
  heading.textContent = "Current trick";
  trickArea.appendChild(heading);

  if (!state.trick) {
    const note = document.createElement("p");
    note.textContent = "No trick in progress.";
    trickArea.appendChild(note);
    return;
  }
  if (!state.trick.plays.length) {
    const waiting = document.createElement("p");
    waiting.textContent = "Waiting for leader.";
    trickArea.appendChild(waiting);
    return;
  }

  const list = document.createElement("ul");
  for (const play of state.trick.plays) {
    const li = document.createElement("li");
    const cardLabel = play.faceDown ? "Card Back" : play.card?.cardId || "Card Back";
    li.textContent = `Seat ${play.seatIndex}: ${cardLabel} ${play.fromIndicator ? "(indicator)" : ""}`;
    list.appendChild(li);
  }
  trickArea.appendChild(list);
}

function renderHandSummary(state) {
  scoreboard.textContent = "";
  const title = document.createElement("h3");
  title.textContent = "Match / Hand Score";
  scoreboard.appendChild(title);

  const points = state.seats.reduce(
    (acc, seat) => {
      acc[seat.team] += seat.trickPoints || 0;
      return acc;
    },
    { A: 0, B: 0 },
  );

  const header = document.createElement("p");
  header.textContent = `Hand #${state.handNumber} | Dealer: Seat ${state.dealerSeat}`;
  const tokenLine = document.createElement("p");
  tokenLine.textContent = `Team A tokens: ${state.tokens?.[0] ?? 0} | Team B tokens: ${state.tokens?.[1] ?? 0}`;
  const pointLine = document.createElement("p");
  pointLine.textContent = `Team A points: ${points.A} | Team B points: ${points.B}`;

  scoreboard.appendChild(header);
  scoreboard.appendChild(tokenLine);
  scoreboard.appendChild(pointLine);
}

function renderTrumpState(state) {
  trumpArea.textContent = "";
  const heading = document.createElement("h3");
  heading.textContent = "Trump";
  trumpArea.appendChild(heading);

  const lines = [];
  if (state.trump?.maker != null) {
    lines.push(`Trump maker seat: Seat ${state.trump.maker}`);
  }
  lines.push(`Bid: ${state.bidding?.currentBid || 0}`);

  if (state.trump?.suit) {
    lines.push(`Trump suit: ${state.trump.suit}`);
    lines.push(`Open: ${state.trump.isOpen ? "yes" : "no"}`);
  } else {
    lines.push("Trump suit: hidden");
  }

  if (state.trump?.indicatorVisible) {
    lines.push("Indicator visible to table.");
  }

  const text = document.createElement("p");
  text.textContent = lines.join(" | ");
  trumpArea.appendChild(text);
}

function renderBidHistory(state) {
  bidHistoryArea.textContent = "";
  const heading = document.createElement("h3");
  heading.textContent = "Bid history";
  bidHistoryArea.appendChild(heading);

  if (!state.bidHistory?.length) {
    const none = document.createElement("p");
    none.textContent = "No bids yet.";
    bidHistoryArea.appendChild(none);
    return;
  }

  const list = document.createElement("ul");
  for (const item of state.bidHistory) {
    const li = document.createElement("li");
    if (item.type === "pass") {
      li.textContent = `Seat ${item.seatIndex}: Pass`;
    } else {
      li.textContent = `Seat ${item.seatIndex}: ${item.amount}`;
    }
    list.appendChild(li);
  }
  bidHistoryArea.appendChild(list);
}

function renderPreviousTrick(state) {
  previousTrickArea.textContent = "";
  const heading = document.createElement("h3");
  heading.textContent = "Previous trick review";
  previousTrickArea.appendChild(heading);

  if (!state.latestTrick || !state.latestTrick.plays.length) {
    const none = document.createElement("p");
    none.textContent = "No completed trick yet.";
    previousTrickArea.appendChild(none);
    return;
  }

  const detail = document.createElement("p");
  detail.textContent = `Trick ${state.latestTrick.trickIndex + 1}`;
  previousTrickArea.appendChild(detail);

  const list = document.createElement("ul");
  for (const play of state.latestTrick.plays) {
    const li = document.createElement("li");
    const card = play.faceDown ? "Card Back" : play.card?.cardId || "Card Back";
    li.textContent = `Seat ${play.seatIndex}: ${card}`;
    list.appendChild(li);
  }
  previousTrickArea.appendChild(list);

  const winner = document.createElement("p");
  winner.textContent = `Winner: Seat ${state.latestTrick.winnerSeat}`;
  previousTrickArea.appendChild(winner);
}

function renderHandAudit(state) {
  handAuditArea.textContent = "";
  const heading = document.createElement("h3");
  heading.textContent = "Hand audit";
  handAuditArea.appendChild(heading);

  const source = state.handResult || {};
  const seedCommit = source.seedCommit || state.handAudit?.seedCommit || "-";
  const deckVersion = source.deckVersion || state.handAudit?.deckVersion || "-";

  handAuditArea.appendChild(Object.assign(document.createElement("p"), { textContent: `Seed commitment: ${seedCommit}` }));
  handAuditArea.appendChild(Object.assign(document.createElement("p"), { textContent: `Deck version: ${deckVersion}` }));

  if (state.phase === "hand_result" || state.phase === "match_complete") {
    const seed = source.shuffleSeed || state.handAudit?.seed || "-";
    handAuditArea.appendChild(Object.assign(document.createElement("p"), { textContent: `Shuffle seed: ${seed}` }));
  } else {
    handAuditArea.appendChild(Object.assign(document.createElement("p"), { textContent: "Shuffle seed is hidden until hand completes." }));
  }
}

function getActionSeat() {
  const state = roomState?.publicState;
  const fromState = getMySeatIndexFromState(state);
  return Number.isFinite(fromState) ? fromState : roomState?.seatIndex || null;
}

function isMyTurn(state) {
  const mySeat = getActionSeat();
  return mySeat != null && state.activeSeat === mySeat;
}

async function submitAction(rawAction) {
  if (!roomState?.roomId || !roomState?.publicState) return;
  const mySeat = getActionSeat();
  if (mySeat == null && rawAction.type !== "ACK_RESULT") {
    setStatus("You are not seated in this room.");
    return;
  }

  const action = {
    ...rawAction,
    actorSeatIndex: Number.isFinite(rawAction.actorSeatIndex) ? rawAction.actorSeatIndex : mySeat,
    seatIndex: Number.isFinite(rawAction.seatIndex) ? rawAction.seatIndex : mySeat,
    clientKnownVersion: roomState.publicState.version,
  };

  try {
    setRequestBusy(true);
    roomState = await apiRequest(`/api/rooms/${encodeURIComponent(roomState.roomId)}/actions`, {
      method: "POST",
      body: action,
    });
    renderCurrentView();
  } catch (error) {
    if (error.status === 409) {
      await refreshRoomState();
    }
    setStatus(error.message || "Action failed.");
  } finally {
    setRequestBusy(false);
  }
}

async function changeSeat(seatIndex) {
  if (!roomState?.roomId) return;
  try {
    setRequestBusy(true);
    roomState = await apiRequest(`/api/rooms/${encodeURIComponent(roomState.roomId)}/seat`, {
      method: "POST",
      body: {
        seatIndex,
        displayName: normalizeDisplayName(playerNameInput.value || sessionState?.displayName || "Guest"),
      },
    });
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    setStatus(error.message || "Could not change seat.");
  } finally {
    setRequestBusy(false);
  }
}

async function setSeatReady(nextReady = null) {
  if (!roomState?.roomId) return;
  try {
    setRequestBusy(true);
    const body = {};
    if (typeof nextReady === "boolean") {
      body.isReady = nextReady;
    }
    roomState = await apiRequest(`/api/rooms/${encodeURIComponent(roomState.roomId)}/ready`, {
      method: "POST",
      body,
    });
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    setStatus(error.message || "Could not update ready state.");
  } finally {
    setRequestBusy(false);
  }
}

function renderActions(state) {
  actionsArea.innerHTML = "";
  myHandArea.innerHTML = "";
  resultSummary.innerHTML = "";

  const actions = roomState?.legalActions || [];
  if (!actions.length) {
    return;
  }

  const phase = state.phase;

  if (phase === "four_bidding" || phase === "second_bidding") {
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.setAttribute("aria-label", action.ariaLabel || action.label);
      btn.addEventListener("click", () => void submitAction(action));
      actionsArea.appendChild(btn);
    }
    return;
  }

  if (phase === "trump_selection" || phase === "trump_choice") {
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.setAttribute("aria-label", action.ariaLabel || action.label);
      btn.addEventListener("click", () => void submitAction(action));
      actionsArea.appendChild(btn);
    }
    return;
  }

  if (phase === "hand_result" || phase === "match_complete") {
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.setAttribute("aria-label", action.ariaLabel || action.label);
      btn.addEventListener("click", () => void submitAction(action));
      actionsArea.appendChild(btn);
    }
    if (state.handResult || roomState.handResult) {
      const result = state.handResult || roomState.handResult;
      const heading = document.createElement("h3");
      heading.textContent = "Hand summary";
      resultSummary.appendChild(heading);
      if (result.noScore) {
        resultSummary.appendChild(Object.assign(document.createElement("p"), { textContent: result.reason }));
      } else {
        resultSummary.appendChild(
          Object.assign(document.createElement("p"), {
            textContent: `Bid ${result.bid} by Team ${result.bidderTeam}. ${result.success ? "Success" : "Failure"}.`,
          }),
        );
        resultSummary.appendChild(
          Object.assign(document.createElement("p"), {
            textContent: `Team points: A ${result.bidderTeamPoints || 0}, B ${result.otherTeamPoints || 0}`,
          }),
        );
        resultSummary.appendChild(
          Object.assign(document.createElement("p"), {
            textContent: `Current tokens: A ${result.tokens?.[0] ?? 0}, B ${result.tokens?.[1] ?? 0}`,
          }),
        );
      }
    }
    return;
  }

  if (phase !== "trick_play") {
    return;
  }

  const mySeat = roomState?.seatView;
  if (!mySeat || mySeat.type !== "human") {
    return;
  }
  if (!isMyTurn(state)) {
    return;
  }

  const container = document.createElement("div");
  container.className = "actions";
  const seen = {};
  for (const action of actions) {
    if (action.type !== "PLAY_CARD") continue;
    const key = `${action.cardId}:${action.faceDown ? "fd" : "up"}:${action.fromIndicator ? "i" : ""}`;
    if (seen[key]) continue;
    seen[key] = true;

    const btn = document.createElement("button");
    btn.className = "hand-card legal";
    btn.textContent = `${action.label}${action.fromIndicator ? " (indicator)" : ""}${action.faceDown ? " (face down)" : ""}`;
    btn.setAttribute("aria-label", action.ariaLabel || action.label);
    if (action.faceDown) btn.classList.add("face-down");
    btn.addEventListener("click", () => void submitAction(action));
    container.appendChild(btn);
  }

  myHandArea.innerHTML = "<h3>Your hand</h3>";
  myHandArea.appendChild(container);
}

function renderLobby() {
  const state = roomState?.publicState;
  roomCode.textContent = `Invite: ${roomState?.inviteCode || ""}`;
  const inviteUrl = roomState?.inviteCode ? buildInviteLink(roomState.inviteCode) : window.location.href;
  roomLink.href = inviteUrl;
  roomLink.textContent = inviteUrl;

  const humanCount = roomState?.seats?.filter((seat) => seat.type === "human").length || 0;
  const secondBidding = roomState?.enableSecondBidding === false ? "off" : "on";
  const readyCount = roomState?.seats?.filter((seat) => seat.type === "human" && seat.isReady).length || 0;
  lobbyHint.textContent = `Players: ${humanCount}/${roomState?.seats.length || 0} • Ready: ${readyCount}/${humanCount} • Second bidding: ${secondBidding}.`;
  lobbySeats.innerHTML = "";
  for (const seat of roomState?.seats || []) {
    lobbySeats.appendChild(renderSeatTile(seat, state?.activeSeat));
  }

  const allReady = roomState?.seats
    ? roomState.seats.every(
        (seat) => seat.type !== "human" || (seat.isReady && (seat.connectionStatus || "disconnected") !== "disconnected"),
      )
    : false;
  startMatchBtn.disabled = !roomState?.isHost || roomState?.status !== "lobby" || !allReady;
  startMatchBtn.textContent = roomState?.isHost ? "Start match" : "Waiting for host";
}

function renderGame() {
  const state = roomState?.publicState;
  if (!state) return;

  gameMessage.textContent = state.gameMessage || "";
  renderPromptLine(state);
  matchBoard.innerHTML = "";
  for (const seat of state.seats) {
    matchBoard.appendChild(renderSeatTile(seat, state.activeSeat));
  }
  renderHandSummary(state);
  renderTrumpState(state);
  renderTrick(state);
  renderBidHistory(state);
  renderPreviousTrick(state);
  renderHandAudit(state);
  renderActions(state);
}

function clearGameUi() {
  gameMessage.textContent = "";
  matchBoard.textContent = "";
  scoreboard.textContent = "";
  trumpArea.textContent = "";
  trickArea.textContent = "";
  handAuditArea.textContent = "";
  bidHistoryArea.textContent = "";
  previousTrickArea.textContent = "";
  myHandArea.textContent = "";
  actionsArea.textContent = "";
  resultSummary.textContent = "";
  promptLine.textContent = "";
}

function renderCurrentView() {
  if (!roomState) {
    setupPanel.classList.remove("hidden");
    lobbyPanel.classList.add("hidden");
    gamePanel.classList.add("hidden");
    return;
  }

  if (roomState.status === "lobby" || !roomState.publicState) {
    clearGameUi();
    setupPanel.classList.add("hidden");
    lobbyPanel.classList.remove("hidden");
    gamePanel.classList.add("hidden");
    renderLobby();
    startPolling();
    return;
  }

  setupPanel.classList.add("hidden");
  lobbyPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
  clearGameUi();
  renderGame();
  startPolling();
}

function buildInviteLink(code) {
  const link = new URL(window.location.href);
  link.searchParams.set("room", code);
  return link.toString();
}

function buildRoomPayload(data) {
  return {
    visibility: "private",
    tableSizeMode: String(data.get("tableMode") || "auto"),
    ruleProfileId: String(data.get("ruleProfile") || "classic_304_4p"),
    botDifficulty: String(data.get("botDifficulty") || "easy"),
    humanCount: Number(data.get("humanCount") || 1),
    enableSecondBidding: data.get("enableSecondBidding") === "on",
  };
}

async function createRoom(payload) {
  const created = await apiRequest("/api/rooms", {
    method: "POST",
    body: payload,
  });
  persistRoomContext(created);
  return created;
}

async function joinRoom(code, playerName) {
  if (!isRoomCode(code)) {
    throw new Error("Invalid room code.");
  }
  return apiRequest(`/api/rooms/${encodeURIComponent(code)}/join`, {
    method: "POST",
    body: { displayName: playerName },
  });
}

async function startMatch() {
  if (!roomState?.roomId || requestInFlight) return;
  try {
    setRequestBusy(true);
    roomState = await apiRequest(`/api/rooms/${encodeURIComponent(roomState.roomId)}/start`, {
      method: "POST",
    });
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    setStatus(error.message || "Could not start match.");
  } finally {
    setRequestBusy(false);
  }
}

async function handleCreateOrJoin(evt) {
  evt.preventDefault();
  const submitMode = evt.submitter?.dataset?.mode || "create";
  const data = new FormData(setupForm);
  const playerName = normalizeDisplayName(data.get("playerName"));
  const joinRoomCode = normalizeRoomCode(data.get("joinRoomCode"));
  const createPayload = buildRoomPayload(data);

  setStatus("");
  try {
    await ensureSession(playerName);
    sessionState.displayName = playerName;
    saveSession(sessionState);

    if (submitMode === "join") {
      if (!joinRoomCode) {
        throw new Error("Enter room code to join.");
      }
      roomState = await joinRoom(joinRoomCode, playerName);
      persistRoomContext(roomState);
    } else {
      roomState = await createRoom(createPayload);
    }
    renderCurrentView();
  } catch (error) {
    setStatus(error.message || "Failed to prepare room.");
  }
}

async function quickPractice() {
  const playerName = normalizeDisplayName(playerNameInput.value || sessionState?.displayName || "Guest");
  const data = new FormData(setupForm);
  const payload = buildRoomPayload(data);
  payload.humanCount = 1;
  payload.tableSizeMode = "auto";

  setStatus("");
  try {
    await ensureSession(playerName);
    sessionState.displayName = playerName;
    saveSession(sessionState);
    roomState = await createRoom(payload);
    renderCurrentView();
  } catch (error) {
    setStatus(error.message || "Could not start practice room.");
  }
}

async function tryAutoJoinFromLastRoom() {
  const lastRoomCode = normalizeRoomCode(sessionState?.lastRoomCode);
  if (!isRoomCode(lastRoomCode) || autoJoinInProgress || roomState) return;

  const playerName = normalizeDisplayName(sessionState?.displayName || playerNameInput.value || "Guest");
  try {
    autoJoinInProgress = true;
    await ensureSession(playerName);
    roomState = await joinRoom(lastRoomCode, playerName);
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    if (error.status === 404 || error.status === 410 || error.status === 401 || error.status === 409) {
      if (sessionState) {
        sessionState.lastRoomCode = null;
        sessionState.lastRoomId = null;
        saveSession(sessionState);
      }
    }
    if ([404, 401, 409].includes(error.status)) {
      setStatus(error.message || "Could not resume last room.");
    }
  } finally {
    autoJoinInProgress = false;
  }
}

function resetToSetup() {
  stopPolling();
  roomState = null;
  clearGameUi();
  lobbySeats.innerHTML = "";
  lobbyHint.textContent = "";
  setupPanel.classList.remove("hidden");
  lobbyPanel.classList.add("hidden");
  gamePanel.classList.add("hidden");
}

async function tryAutoJoinFromQuery() {
  const code = normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
  if (!isRoomCode(code) || autoJoinInProgress || roomState) return;

  const playerName = normalizeDisplayName(sessionState?.displayName || playerNameInput.value || "Guest");
  try {
    autoJoinInProgress = true;
    await ensureSession(playerName);
    roomState = await joinRoom(code, playerName);
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    setStatus(error.message || "Could not auto join room.");
  } finally {
    autoJoinInProgress = false;
  }
}

function hydrateProfileSelect() {
  const currentProfile = ruleProfilesSelect.value;
  ruleProfilesSelect.innerHTML = "";
  const fallback = [
    { id: "classic_304_4p", name: "Classic 304 (4-seat)" },
    { id: "six_304_36", name: "Six-seat 304-36" },
  ];

  for (const profile of fallback) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    if (profile.id === (currentProfile || "classic_304_4p")) {
      option.selected = true;
    }
    ruleProfilesSelect.appendChild(option);
  }
}

function bindEvents() {
  setupForm.addEventListener("submit", handleCreateOrJoin);
  quickPlayBtn.addEventListener("click", () => void quickPractice());
  startMatchBtn.addEventListener("click", () => void startMatch());
  createNewBtn.addEventListener("click", () => {
    resetToSetup();
    if (sessionState?.displayName) {
      playerNameInput.value = sessionState.displayName;
    }
    setStatus("");
  });
}

function init() {
  hydrateProfileSelect();
  bindEvents();

  const stored = loadStoredSession();
  if (stored) {
    sessionState = stored;
    playerNameInput.value = normalizeDisplayName(stored.displayName, "Guest");
  }

  const queryRoom = normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
  if (isRoomCode(queryRoom)) {
    joinRoomInput.value = queryRoom;
    void tryAutoJoinFromQuery();
    return;
  }
  if (sessionState?.lastRoomCode) {
    void tryAutoJoinFromLastRoom();
  }

  setupPanel.classList.remove("hidden");
  lobbyPanel.classList.add("hidden");
  gamePanel.classList.add("hidden");
}

init();
