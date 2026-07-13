import {
  clearGameUiElements,
  formatLobbySeatAvailability,
  formatSeatLabel,
} from "./view.js";

const setupForm = document.getElementById("setup-form");
const setupPanel = document.getElementById("setup-panel");
const lobbyPanel = document.getElementById("lobby-panel");
const gamePanel = document.getElementById("game-panel");

const roomCode = document.getElementById("room-code");
const roomLink = document.getElementById("room-link");
const lobbySeats = document.getElementById("lobby-seats");
const lobbyHint = document.getElementById("lobby-hint");
const publicRoomsStatus = document.getElementById("public-rooms-status");
const publicRoomsList = document.getElementById("public-rooms-list");
const refreshPublicRoomsBtn = document.getElementById("refresh-public-btn");

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
const announcementBanner = document.getElementById("announcement-banner");
const phaseHelpText = document.getElementById("phase-help-text");

const playerNameInput = document.getElementById("player-name");
const joinRoomInput = document.getElementById("join-room-code");

const ruleProfilesSelect = document.getElementById("rule-profile");
const SESSION_STORAGE_KEY = "304-game-session-v1";
const POLL_INTERVAL_MS = 1500;
const CARD_KEY_MAP = {
  clubs: "Clubs",
  diamonds: "Diamonds",
  hearts: "Hearts",
  spades: "Spades",
};

const PHASE_HELP_TEXT = {
  setup: "Setup: choose host options and wait in lobby. Invite others with the room link or code.",
  four_bidding: "Bidding: choose a bid higher than the current bid or pass. A bid is your team's promised points.",
  second_bidding: "Second bidding: you may improve on the previous bid or pass.",
  trump_selection: "Trump selection: choose one eligible card. Only suits matter for trump.",
  trump_choice: "Trump choice: open keeps trump visible; closed hides it until a legal cut/open event.",
  trick_play: "Trick play: play a legal card. Follow suit if possible; if not, you may cut with trump when appropriate.",
  hand_result: "Hand finished: review result and click Next hand to continue.",
  match_complete: "Match finished: review tokens and click Next hand to start a rematch.",
};

const ROOM_VISIBILITY_LABELS = {
  private: "Private",
  public: "Public",
};

const SETTINGS = {
  soundEnabled: true,
  animationSpeed: "normal",
  cardSize: "medium",
};

const PUBLIC_ROOMS_REFRESH_MS = 10000;

const ANIMATION_SPEED_MAP = {
  fast: "70ms",
  normal: "130ms",
  reduced: "0ms",
};

const CARD_SIZE_MAP = {
  small: { fontSize: "13px", minWidth: "82px", minHeight: "32px" },
  medium: { fontSize: "15px", minWidth: "96px", minHeight: "38px" },
  large: { fontSize: "17px", minWidth: "112px", minHeight: "44px" },
};

let sessionState = null;
let roomState = null;
let pollTimer = null;
let requestInFlight = false;
let autoJoinInProgress = false;
let playableHandButtons = [];
let audioContext = null;
let audioGainNode = null;
let publicRoomsRefreshInFlight = false;
let lastPublicRoomsLoadAt = 0;

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text ? text : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return /^(1|true|yes|on)$/i.test(value.trim());
  }
  return fallback;
}

function normalizeCardSize(value) {
  const candidate = String(value || SETTINGS.cardSize).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CARD_SIZE_MAP, candidate) ? candidate : SETTINGS.cardSize;
}

function normalizeAnimationSpeed(value) {
  const candidate = String(value || SETTINGS.animationSpeed).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ANIMATION_SPEED_MAP, candidate) ? candidate : SETTINGS.animationSpeed;
}

function normalizeSettings(rawSettings = {}) {
  return {
    soundEnabled: normalizeBoolean(rawSettings.soundEnabled, SETTINGS.soundEnabled),
    animationSpeed: normalizeAnimationSpeed(rawSettings.animationSpeed),
    cardSize: normalizeCardSize(rawSettings.cardSize),
  };
}

function getSettingsFromForm() {
  const speedSelect = document.getElementById("animation-speed");
  const sizeSelect = document.getElementById("card-size");
  const soundInput = document.getElementById("sound-enabled");
  return normalizeSettings({
    soundEnabled: soundInput ? soundInput.checked : SETTINGS.soundEnabled,
    animationSpeed: speedSelect ? speedSelect.value : SETTINGS.animationSpeed,
    cardSize: sizeSelect ? sizeSelect.value : SETTINGS.cardSize,
  });
}

function applySettings(settings) {
  const normalized = normalizeSettings(settings);
  const cardSize = CARD_SIZE_MAP[normalized.cardSize];
  if (document && document.documentElement) {
    document.documentElement.style.setProperty("--card-font-size", cardSize.fontSize);
    document.documentElement.style.setProperty("--card-min-width", cardSize.minWidth);
    document.documentElement.style.setProperty("--card-min-height", cardSize.minHeight);
    document.documentElement.style.setProperty("--animation-duration", ANIMATION_SPEED_MAP[normalized.animationSpeed]);
  }
  if (sessionState) {
    sessionState.settings = normalized;
    saveSession(sessionState);
  }

  const soundInput = document.getElementById("sound-enabled");
  const speedSelect = document.getElementById("animation-speed");
  const sizeSelect = document.getElementById("card-size");
  if (soundInput) soundInput.checked = normalized.soundEnabled;
  if (speedSelect) speedSelect.value = normalized.animationSpeed;
  if (sizeSelect) sizeSelect.value = normalized.cardSize;
}

function getToneConfigForAction(actionType = "") {
  const type = String(actionType || "").toLowerCase();
  if (type === "bid") return 880;
  if (type === "pass_bid") return 450;
  if (type === "select_trump") return 620;
  if (type === "trump_open") return 760;
  if (type === "trump_close") return 380;
  if (type === "ack_result") return 300;
  if (type === "play_card") return 680;
  return 500;
}

function ensureAudioContext() {
  if (!("AudioContext" in window) && !("webkitAudioContext" in window)) {
    return null;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!audioContext) {
    audioContext = new Ctx();
    audioGainNode = audioContext.createGain();
    audioGainNode.gain.value = 0.08;
    audioGainNode.connect(audioContext.destination);
  }
  return audioContext;
}

function playSound(actionType) {
  if (!sessionState?.settings?.soundEnabled) {
    return;
  }
  const context = ensureAudioContext();
  if (!context || !audioGainNode) {
    return;
  }
  if (context.state === "suspended") {
    context
      .resume()
      .then(() => playTone(context, audioGainNode, getToneConfigForAction(actionType)))
      .catch(() => {});
    return;
  }
  playTone(context, audioGainNode, getToneConfigForAction(actionType));
}

function playTone(context, gainNode, frequency) {
  const safeFreq = Number.isFinite(frequency) ? frequency : 500;
  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.value = safeFreq;
  oscillator.connect(gainNode);
  const start = context.currentTime;
  oscillator.start(start);
  oscillator.stop(start + 0.12);
}

function normalizeDisplayName(value) {
  const text = normalizeText(value, "Guest");
  return text.slice(0, 24);
}

function getDisplayNameForSeat(seat) {
  if (!seat) return "Guest";
  if (seat.type === "bot" && !seat.displayName) {
    const index = Number.isFinite(Number(seat.index)) ? Math.trunc(Number(seat.index)) : 0;
    const botLabel = `Bot ${((index % 8) + 8) % 8 + 1}`;
    return botLabel;
  }
  return normalizeText(seat.displayName, "Guest");
}

function normalizeRoomVisibility(value) {
  const candidate = normalizeText(value, "private").toLowerCase();
  return candidate === "public" ? "public" : "private";
}

function getUserFacingErrorMessage(error, fallback = "Request failed.") {
  const details = error?.payload?.details;
  if (!error || error?.status == null) {
    return error?.message || fallback;
  }
  if (details?.code === "classic_4_full") {
    return "This room is set to Classic 4-seat mode. Ask the host to switch to Six-player mode or join as spectator when spectator mode is available.";
  }
  if (details?.code === "profile_table_mismatch") {
    return "This profile supports 4-seat classic flow only. For 5-6 players, switch to six-seat profile.";
  }
  if (details?.code === "profile_seat_count_mismatch") {
    return "Room table size and selected profile are incompatible. Recreate the room with matching settings.";
  }
  return error?.payload?.error || error.message || fallback;
}

function getProfileLabel(profileId) {
  const id = String(profileId || "classic_304_4p");
  if (id === "six_304_36") {
    return "Six-seat 304-36";
  }
  return "Classic 304 (4-seat)";
}

function getTableModeLabel(mode) {
  const tableMode = String(mode || "auto");
  if (tableMode === "classic_4") return "Classic 4-seat";
  if (tableMode === "six_6") return "Six-seat";
  return "Auto";
}

function normalizeRoomCode(value) {
  return normalizeText(value, "").toUpperCase();
}

function isRoomCode(value) {
  return /^304-[A-Z0-9]{12}$/.test(normalizeRoomCode(value));
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

function normalizeCardForSpeech(card) {
  if (!card || typeof card !== "object") {
    return { rank: "", suit: "", points: null };
  }
  return {
    rank: String(card.rank || "").trim(),
    suit: String(card.suit || "").trim(),
    points: Number.isFinite(Number(card.points)) ? Number(card.points) : null,
  };
}

function formatActionCardLabel(card) {
  const normalized = normalizeCardForSpeech(card);
  if (!normalized.rank || !normalized.suit) {
    return "unknown card";
  }
  const suitName = CARD_KEY_MAP[normalized.suit] || normalized.suit;
  const points = normalized.points != null ? `, ${normalized.points} points` : "";
  return `${normalized.rank} of ${suitName}${points}`;
}

function getActionAriaLabel(action) {
  if (!action || typeof action !== "object") return "Action";
  if (action.type === "PLAY_CARD") {
    if (action.cardId === "__trump_indicator__") {
      return "Play hidden trump indicator card";
    }
    if (action.card) {
      return `Play ${formatActionCardLabel(action.card)}${action.faceDown ? ", face down" : ""}`;
    }
    return `Play ${action.label || "card"}`;
  }
  if (action.ariaLabel) return action.ariaLabel;
  return action.label || action.type || "Action";
}

function updatePhaseHelp(state) {
  if (!phaseHelpText) return;
  const phase = String(state?.phase || "setup");
  const base = PHASE_HELP_TEXT[phase] || "";
  const detail = [];
  if (state.trump?.suit) {
    const trumpSuit = CARD_KEY_MAP[state.trump.suit] || state.trump.suit;
    detail.push(`Current trump: ${trumpSuit} (${state.trump.isOpen ? "open" : "closed"}).`);
  }
  if (Number.isFinite(state?.trump?.maker)) {
    detail.push(`Trump maker: ${formatSeatLabel(state.trump.maker)}.`);
  }
  if (state.activeSeat != null) {
    detail.push(`Turn: ${formatSeatLabel(state.activeSeat)}.`);
  }
  if (state.phase === "trick_play" && state.currentTrick) {
    detail.push(`Cards played this trick: ${state.currentTrick.plays?.length || 0}.`);
  }
  phaseHelpText.textContent = `${base}${detail.length ? ` ${detail.join(" ")}` : ""}`;
}

function announce(message) {
  if (!announcementBanner) return;
  announcementBanner.textContent = message || "";
}

function loadStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.sessionToken || !parsed.userId) return null;
    parsed.settings = normalizeSettings(parsed.settings || {});
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

function setPublicRoomsStatus(text) {
  if (publicRoomsStatus) {
    publicRoomsStatus.textContent = String(text || "").trim();
  }
}

function createPublicRoomCard(room) {
  const card = document.createElement("div");
  card.className = "public-room-card";

  const heading = document.createElement("h3");
  heading.textContent = `${getProfileLabel(room.ruleProfileId)} • ${getTableModeLabel(room.tableSizeMode)}`;
  card.appendChild(heading);

  const meta = document.createElement("p");
  meta.textContent = `Code: ${room.inviteCode} • Seats: ${room.humanCount}/${room.maxHumans} • ${
    room.botDifficulty || "easy"
  } bots`;
  card.appendChild(meta);

  const status = document.createElement("p");
  status.className = "muted-note";
  const readiness = room.hasReadyHuman ? " some players ready" : " no ready seats";
  status.textContent = `State: ${room.status} • ${readiness}`;
  card.appendChild(status);

  const joinButton = document.createElement("button");
  joinButton.type = "button";
  joinButton.className = "seat-action";
  joinButton.disabled = !room.isJoinable;
  joinButton.textContent = room.isJoinable ? "Join room" : "Room full";
  joinButton.disabled = !room.isJoinable;
  joinButton.setAttribute("aria-label", `Join public room ${room.inviteCode}`);
  if (room.isJoinable) {
    joinButton.addEventListener("click", () => {
      void joinPublicRoom(room.inviteCode);
    });
  }
  card.appendChild(joinButton);
  return card;
}

async function joinPublicRoom(inviteCode) {
  const code = normalizeRoomCode(inviteCode);
  if (!isRoomCode(code)) {
    setStatus("Invalid room code.");
    return;
  }
  const playerName = normalizeDisplayName(playerNameInput.value || sessionState?.displayName || "Guest");
  try {
    await ensureSession(playerName);
    applySettings(getSettingsFromForm());
    sessionState.displayName = playerName;
    saveSession(sessionState);
    roomState = await joinRoom(code, playerName);
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    setStatus(getUserFacingErrorMessage(error, "Could not join selected room."));
  }
}

async function refreshPublicRooms({ force = false } = {}) {
  const now = Date.now();
  if (!force && publicRoomsRefreshInFlight) {
    return;
  }
  if (!force && now - lastPublicRoomsLoadAt < PUBLIC_ROOMS_REFRESH_MS) {
    return;
  }
  if (publicRoomsList && refreshPublicRoomsBtn) {
    publicRoomsList.textContent = "";
  }
  if (!publicRoomsStatus) return;

  try {
    publicRoomsRefreshInFlight = true;
    setPublicRoomsStatus("Loading public rooms...");
    if (refreshPublicRoomsBtn) {
      refreshPublicRoomsBtn.disabled = true;
    }
    const response = await apiRequest("/api/rooms", {
      method: "GET",
    });
    const rooms = Array.isArray(response?.rooms) ? response.rooms : [];
    if (!publicRoomsList) {
      return;
    }
    publicRoomsList.innerHTML = "";
    if (rooms.length === 0) {
      setPublicRoomsStatus("No public rooms available.");
      return;
    }
    for (const room of rooms) {
      publicRoomsList.appendChild(createPublicRoomCard(room));
    }
    setPublicRoomsStatus(`Found ${rooms.length} public room${rooms.length === 1 ? "" : "s"}.`);
    lastPublicRoomsLoadAt = now;
  } catch (error) {
    setPublicRoomsStatus(getUserFacingErrorMessage(error, "Could not load public rooms."));
  } finally {
    publicRoomsRefreshInFlight = false;
    if (refreshPublicRoomsBtn) {
      refreshPublicRoomsBtn.disabled = false;
    }
  }
}

function setStatus(message = "") {
  gameMessage.textContent = message;
  announce(message);
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
    sessionState.settings = normalizeSettings(sessionState.settings);
    applySettings(sessionState.settings);
    return sessionState;
  }

  const stored = loadStoredSession();
  if (stored?.sessionToken) {
    sessionState = stored;
    playerNameInput.value = normalizeDisplayName(sessionState.displayName, stored.displayName);
    sessionState.settings = normalizeSettings(sessionState.settings);
    applySettings(sessionState.settings);
    return sessionState;
  }

  const created = await apiRequest("/api/guest-session", {
    method: "POST",
    body: { displayName: normalizeDisplayName(displayName, "Guest") },
  });

  sessionState = { ...created, settings: normalizeSettings(created.settings) };
  saveSession(sessionState);
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
  header.textContent = `${getDisplayNameForSeat(seat)}`;
  card.appendChild(header);

  const seatLine = document.createElement("p");
  seatLine.textContent = `${seat.type.toUpperCase()} • ${seat.team} • ${formatSeatLabel(seat.index)}`;
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
      messages.push(`${formatSeatLabel(activeSeat)} to play.`);
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
    li.textContent = `${formatSeatLabel(play.seatIndex)}: ${cardLabel} ${play.fromIndicator ? "(indicator)" : ""}`;
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
  header.textContent = `Hand #${state.handNumber} | Dealer: ${formatSeatLabel(state.dealerSeat)}`;
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
    lines.push(`Trump maker seat: ${formatSeatLabel(state.trump.maker)}`);
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
      li.textContent = `${formatSeatLabel(item.seatIndex)}: Pass`;
    } else {
      li.textContent = `${formatSeatLabel(item.seatIndex)}: ${item.amount}`;
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
    li.textContent = `${formatSeatLabel(play.seatIndex)}: ${card}`;
    list.appendChild(li);
  }
  previousTrickArea.appendChild(list);

  const winner = document.createElement("p");
  winner.textContent = `Winner: ${formatSeatLabel(state.latestTrick.winnerSeat)}`;
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
    playSound(action.type);
    renderCurrentView();
  } catch (error) {
    if (error.status === 409) {
      await refreshRoomState();
    }
    setStatus(getUserFacingErrorMessage(error, "Action failed."));
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
  playableHandButtons = [];

  const actions = roomState?.legalActions || [];
  if (!actions.length) {
    return;
  }

  const phase = state.phase;

  if (phase === "four_bidding" || phase === "second_bidding") {
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.setAttribute("aria-label", getActionAriaLabel(action));
      btn.addEventListener("click", () => void submitAction(action));
      actionsArea.appendChild(btn);
    }
    return;
  }

  if (phase === "trump_selection" || phase === "trump_choice") {
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.setAttribute("aria-label", getActionAriaLabel(action));
      btn.addEventListener("click", () => void submitAction(action));
      actionsArea.appendChild(btn);
    }
    return;
  }

  if (phase === "hand_result" || phase === "match_complete") {
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      btn.setAttribute("aria-label", getActionAriaLabel(action));
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
  container.setAttribute("aria-label", "Your legal hand actions");
  const seen = {};
  for (const action of actions) {
    if (action.type !== "PLAY_CARD") continue;
    const key = `${action.cardId}:${action.faceDown ? "fd" : "up"}:${action.fromIndicator ? "i" : ""}`;
    if (seen[key]) continue;
    seen[key] = true;

    const btn = document.createElement("button");
    btn.className = "hand-card legal";
    btn.textContent = `${action.label}${action.fromIndicator ? " (indicator)" : ""}${action.faceDown ? " (face down)" : ""}`;
    btn.setAttribute("aria-label", getActionAriaLabel(action));
    btn.dataset.handAction = "1";
    if (action.faceDown) btn.classList.add("face-down");
    btn.addEventListener("click", () => void submitAction(action));
    container.appendChild(btn);
    playableHandButtons.push(btn);
  }
  if (playableHandButtons.length) {
    playableHandButtons[0].setAttribute("tabindex", "0");
  }

  if (playableHandButtons.length > 1) {
    actionsArea.textContent = "";
    const arrowHint = document.createElement("p");
    arrowHint.textContent = "Use Left/Right arrow keys to choose a playable card. Press Enter to play.";
    arrowHint.className = "status";
    actionsArea.appendChild(arrowHint);
  }

  myHandArea.innerHTML = "<h3>Your hand</h3>";
  myHandArea.appendChild(container);
}

function getSeatStatusText(seat) {
  if (!seat) return "Disconnected";
  if (seat.autopilot) return "Autopilot";
  return formatSeatStatusLabel(seat);
}

function renderLobby() {
  const state = roomState?.publicState;
  roomCode.textContent = `Invite: ${roomState?.inviteCode || ""}`;
  const inviteUrl = roomState?.joinUrl ? new URL(roomState.joinUrl, window.location.origin).toString() : roomState?.inviteCode ? buildInviteLink(roomState.inviteCode) : window.location.href;
  roomLink.href = inviteUrl;
  roomLink.textContent = inviteUrl;

  const humanCount = roomState?.seats?.filter((seat) => seat.type === "human").length || 0;
  const visibilityLabel = ROOM_VISIBILITY_LABELS[roomState?.visibility] || ROOM_VISIBILITY_LABELS.private;
  const tableMode = roomState?.tableSizeMode || "auto";
  const tableModeLabel =
    tableMode === "classic_4" ? "Classic 4-seat" : tableMode === "six_6" ? "Six-seat" : "Auto";
  const secondBidding = roomState?.enableSecondBidding === false ? "off" : "on";
  const readyCount = roomState?.seats?.filter((seat) => seat.type === "human" && seat.isReady).length || 0;
  const availabilityHint = formatLobbySeatAvailability(roomState?.seats);
  lobbyHint.textContent = `Players: ${humanCount}/${roomState?.seats.length || 0} • Ready: ${readyCount}/${humanCount} • Table: ${tableModeLabel} • Visibility: ${visibilityLabel} • Second bidding: ${secondBidding}.${availabilityHint ? ` ${availabilityHint}` : ""}`;
  lobbySeats.innerHTML = "";
  for (const seat of roomState?.seats || []) {
    lobbySeats.appendChild(renderSeatTile(seat, state?.activeSeat));
  }

  const hostCanStart = roomState?.isHost && roomState?.status === "lobby" && humanCount >= 1;
  startMatchBtn.disabled = !hostCanStart;
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
  clearGameUiElements({
    gameMessage,
    announcementBanner,
    matchBoard,
    scoreboard,
    trumpArea,
    trickArea,
    handAuditArea,
    bidHistoryArea,
    previousTrickArea,
    myHandArea,
    actionsArea,
    resultSummary,
    promptLine,
  });
}

function renderCurrentView() {
  if (!roomState) {
    setupPanel.classList.remove("hidden");
    lobbyPanel.classList.add("hidden");
    gamePanel.classList.add("hidden");
    if (phaseHelpText) phaseHelpText.textContent = "";
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
  playableHandButtons = [];
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
    visibility: normalizeRoomVisibility(data.get("visibility")),
    tableSizeMode: String(data.get("tableMode") || "auto"),
    ruleProfileId: String(data.get("ruleProfile") || "classic_304_4p"),
    botDifficulty: String(data.get("botDifficulty") || "easy"),
    humanCount: Number(data.get("humanCount") || 1),
    enableSecondBidding: data.get("enableSecondBidding") === "on",
  };
}

function focusNextHandCard(offset) {
  if (!playableHandButtons.length) return;
  const current = document.activeElement;
  const currentIndex = playableHandButtons.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + offset + playableHandButtons.length) % playableHandButtons.length;
  playableHandButtons.forEach((btn) => btn.setAttribute("tabindex", "-1"));
  const button = playableHandButtons[nextIndex];
  button.setAttribute("tabindex", "0");
  button.focus();
}

function handleGlobalKeydown(event) {
  if (!playableHandButtons.length) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const isTyping = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
  if (!playableHandButtons.includes(target) && !actionsArea.contains(target) && !myHandArea.contains(target)) {
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    focusNextHandCard(-1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    focusNextHandCard(1);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (target instanceof HTMLElement) {
      target.blur();
    }
    return;
  }
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

function formatUnreadySeatLabel(seat) {
  if (!seat) return "";
  const displayName = getDisplayNameForSeat(seat);
  if (seat.connectionStatus === "disconnected") return `${formatSeatLabel(seat.index)} (${displayName} - disconnected)`;
  return `${formatSeatLabel(seat.index)} (${displayName} - not ready)`;
}

function hasReadyConflictError(error, forceMode) {
  const details = error?.payload?.details;
  return !forceMode && error?.status === 409 && details?.requiresForceStart === true;
}

function extractUnreadySeats(payload) {
  const unready = payload?.details?.unreadyHumanSeats;
  return Array.isArray(unready) ? unready : [];
}

async function startMatch(forceStart = false) {
  if (!roomState?.roomId || requestInFlight) return;
  try {
    setRequestBusy(true);
    const response = await apiRequest(`/api/rooms/${encodeURIComponent(roomState.roomId)}/start`, {
      method: "POST",
      body: forceStart ? { forceStart: true } : undefined,
    });
    roomState = response;
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    if (hasReadyConflictError(error, forceStart)) {
      const unreadySeats = extractUnreadySeats(error.payload);
      const formatted = unreadySeats.length
        ? unreadySeats.map(formatUnreadySeatLabel).join(", ")
        : "some players";
      const shouldStart = window.confirm(
        `Not everyone is ready: ${formatted}. Start anyway with host override?`,
      );
      if (shouldStart) {
        void startMatch(true);
        return;
      }
    }
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
    applySettings(getSettingsFromForm());
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
    setStatus(getUserFacingErrorMessage(error, "Failed to prepare room."));
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
    applySettings(getSettingsFromForm());
    sessionState.displayName = playerName;
    saveSession(sessionState);
    roomState = await createRoom(payload);
    renderCurrentView();
  } catch (error) {
    setStatus(getUserFacingErrorMessage(error, "Could not start practice room."));
  }
}

async function tryAutoJoinFromLastRoom() {
  const lastRoomCode = normalizeRoomCode(sessionState?.lastRoomCode);
  if (!isRoomCode(lastRoomCode) || autoJoinInProgress || roomState) return;

  const playerName = normalizeDisplayName(sessionState?.displayName || playerNameInput.value || "Guest");
  try {
    autoJoinInProgress = true;
    applySettings(getSettingsFromForm());
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
      setStatus(getUserFacingErrorMessage(error, "Could not resume last room."));
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
    applySettings(getSettingsFromForm());
    await ensureSession(playerName);
    roomState = await joinRoom(code, playerName);
    persistRoomContext(roomState);
    renderCurrentView();
  } catch (error) {
    setStatus(getUserFacingErrorMessage(error, "Could not auto join room."));
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
  const soundInput = document.getElementById("sound-enabled");
  const animationInput = document.getElementById("animation-speed");
  const cardSizeInput = document.getElementById("card-size");
  if (soundInput) {
    soundInput.addEventListener("change", () => applySettings(getSettingsFromForm()));
  }
  if (animationInput) {
    animationInput.addEventListener("change", () => applySettings(getSettingsFromForm()));
  }
  if (cardSizeInput) {
    cardSizeInput.addEventListener("change", () => applySettings(getSettingsFromForm()));
  }
  createNewBtn.addEventListener("click", () => {
    resetToSetup();
    if (sessionState?.displayName) {
      playerNameInput.value = sessionState.displayName;
    }
    setStatus("");
  });
  document.addEventListener("keydown", handleGlobalKeydown);
}

function clearAnnouncements() {
  if (announcementBanner) {
    announcementBanner.textContent = "";
  }
}

function init() {
  hydrateProfileSelect();
  bindEvents();

  applySettings(SETTINGS);
  const stored = loadStoredSession();
  if (stored) {
    sessionState = stored;
    playerNameInput.value = normalizeDisplayName(stored.displayName, "Guest");
    applySettings(stored.settings || SETTINGS);
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
  clearAnnouncements();
}

init();
