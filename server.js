const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");

function parseBooleanSetting(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function parseOriginList(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];
  const deduped = new Set();
  value
    .split(",")
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach((origin) => deduped.add(origin));
  return [...deduped];
}

function parseIntegerSetting(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const clipped = Math.trunc(parsed);
  if (clipped < minimum || clipped > maximum) {
    return fallback;
  }
  return clipped;
}

const ROOT_DIR = process.cwd();
const APP_NAME = "304-game";
const APP_VERSION = "1.0.0";
const NODE_ENV = process.env.NODE_ENV || "production";
const PORT = parseIntegerSetting(process.env.PORT, 4173, 1024, 65535);
const MAX_JSON_BODY_BYTES = parseIntegerSetting(process.env.MAX_JSON_BODY_BYTES, 32 * 1024, 1024, 2 * 1024 * 1024);
const ROOM_PRESENCE_TIMEOUT_MS = parseIntegerSetting(process.env.ROOM_PRESENCE_TIMEOUT_MS, 120 * 1000, 10 * 1000, 30 * 60 * 1000);
const DISCONNECT_GRACE_MS = parseIntegerSetting(process.env.DISCONNECT_GRACE_MS, 30 * 1000, 5 * 1000, 15 * 60 * 1000);
const ROOM_GC_AFTER_MS = parseIntegerSetting(process.env.ROOM_GC_AFTER_MS, 60 * 60 * 1000, 10 * 60 * 1000, 48 * 60 * 60 * 1000);
const SESSION_TTL_MS = parseIntegerSetting(process.env.SESSION_TTL_MS, 24 * 60 * 60 * 1000, 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000);
const CLEANUP_INTERVAL_MS = parseIntegerSetting(process.env.CLEANUP_INTERVAL_MS, 5 * 60 * 1000, 30 * 1000, 60 * 60 * 1000);
const MAX_SESSIONS_IN_MEMORY = parseIntegerSetting(process.env.MAX_SESSIONS_IN_MEMORY, 5000, 100, 500000);
const MAX_ROOMS_IN_MEMORY = parseIntegerSetting(process.env.MAX_ROOMS_IN_MEMORY, 1200, 32, 200000);
const REQUEST_TIMEOUT_MS = parseIntegerSetting(process.env.REQUEST_TIMEOUT_MS, 15 * 1000, 250, 120000);
const TRUST_PROXY = parseBooleanSetting(process.env.TRUST_PROXY, false);
const MAX_SESSION_TOKEN_LEN = parseIntegerSetting(process.env.MAX_SESSION_TOKEN_LEN, 80, 32, 256);
const REQUIRE_ORIGIN_CHECK = parseBooleanSetting(process.env.REQUIRE_ORIGIN_CHECK, NODE_ENV === "production");
const ALLOWED_ORIGINS = parseOriginList(process.env.ALLOWED_ORIGINS);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "off",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Origin-Agent-Cluster": "?1",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

const ENGINE_MODULE = pathToFileURL(path.join(ROOT_DIR, "src/engine/engine.js")).href;
const PROFILES_MODULE = pathToFileURL(path.join(ROOT_DIR, "src/engine/profiles.js")).href;

let engineModulePromise;
let profilesModulePromise;

const rooms = new Map();
const roomsByCode = new Map();
const sessions = new Map();
const rateLimits = new Map();

const ROOM_RATE_LIMITS = {
  guest_session: { limit: 45, windowMs: 60 * 1000 },
  create_room: { limit: 10, windowMs: 60 * 60 * 1000 },
  join_room: { limit: 30, windowMs: 60 * 60 * 1000 },
  events: { limit: 120, windowMs: 60 * 1000 },
  room_action: { limit: 5, windowMs: 1000 },
  start_room: { limit: 10, windowMs: 60000 },
};
const BOT_THINKING_DELAY_MS = {
  easy: {
    min: parseIntegerSetting(process.env.BOT_THINK_DELAY_EASY_MIN_MS, 1200, 300, 15000),
    max: parseIntegerSetting(process.env.BOT_THINK_DELAY_EASY_MAX_MS, 3500, 300, 20000),
  },
  normal: {
    min: parseIntegerSetting(process.env.BOT_THINK_DELAY_NORMAL_MIN_MS, 900, 250, 12000),
    max: parseIntegerSetting(process.env.BOT_THINK_DELAY_NORMAL_MAX_MS, 2800, 250, 15000),
  },
  strong: {
    min: parseIntegerSetting(process.env.BOT_THINK_DELAY_STRONG_MIN_MS, 700, 220, 9000),
    max: parseIntegerSetting(process.env.BOT_THINK_DELAY_STRONG_MAX_MS, 2600, 220, 12000),
  },
};
const BOT_AUTOPILOT_DELAY_FACTOR = parseIntegerSetting(process.env.BOT_AUTOPILOT_DELAY_FACTOR, 130, 70, 220) / 100;
const BOT_DISPLAY_NAMES = [
  "Bot Nimal",
  "Bot Kavindi",
  "Bot Sahan",
  "Bot Amaya",
  "Bot Ruwan",
  "Bot Thara",
  "Bot Nayana",
  "Bot Dilan",
];

function applySecurityHeaders(response) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(key, value);
  }
}

const PUBLIC_STATIC_FILES = new Set(["/", "/index.html", "/styles.css"]);
const PUBLIC_STATIC_PREFIXES = ["/src/ui/", "/assets/"];

function safePath(urlPath) {
  try {
    const decoded = decodeURIComponent(urlPath);
    if (decoded.includes("\0") || decoded.includes("\\")) return null;
    const relativeInput = decoded.replace(/^\/+/, "");
    if (relativeInput.split("/").includes("..")) return null;
    const normalized = path.posix.normalize(`/${relativeInput}`);
    const relativePath = normalized.replace(/^\/+/, "");
    return relativePath ? `/${relativePath}` : "/";
  } catch {
    return null;
  }
}

function isPublicStaticPath(cleanPath) {
  return (
    PUBLIC_STATIC_FILES.has(cleanPath) ||
    PUBLIC_STATIC_PREFIXES.some((prefix) => cleanPath.startsWith(prefix))
  );
}

function resolveFile(requested) {
  const cleanPath = safePath(requested);
  if (!cleanPath || !isPublicStaticPath(cleanPath)) return null;
  const candidate =
    cleanPath === "/"
      ? path.join(ROOT_DIR, "index.html")
      : path.resolve(ROOT_DIR, `.${cleanPath}`);
  if (!candidate.startsWith(`${ROOT_DIR}${path.sep}`)) {
    return null;
  }
  try {
    const stat = fs.statSync(candidate);
    return stat.isDirectory() ? null : candidate;
  } catch {
    return null;
  }
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  applySecurityHeaders(response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

function writeHealth(response) {
  writeJson(response, 200, {
    name: "304-game",
    version: APP_VERSION,
    env: NODE_ENV,
    status: "ok",
    updatedAt: new Date().toISOString(),
  });
}

function writeError(response, statusCode, message, details) {
  writeJson(response, statusCode, {
    error: message,
    details: details || null,
  });
}

function writeResponse(filePath, reqMethod, response) {
  const extension = path.extname(filePath);
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  const isHtml = extension === ".html";
  const isBrowserCode = extension === ".css" || extension === ".js";
  response.statusCode = 200;
  applySecurityHeaders(response);
  response.setHeader("Content-Type", contentType);
  response.setHeader(
    "Cache-Control",
    isHtml
      ? "no-cache, no-store, must-revalidate"
      : isBrowserCode
        ? "no-cache"
        : "public, max-age=31536000, immutable",
  );
  if (reqMethod !== "HEAD") {
    response.end(data);
  } else {
    response.end();
  }
}

function nowMs() {
  return Date.now();
}

function nowIsoString() {
  return new Date().toISOString();
}

function touchSeatPresence(room, seatIndex, status = "online") {
  const seat = room?.seats?.[seatIndex];
  if (!seat) return;
  seat.connectionStatus = status;
  seat.lastSeenAt = nowIsoString();
  room.updatedAt = seat.lastSeenAt;
  if (status === "online") {
    seat.autopilot = false;
    seat.disconnectedAt = null;
    seat.reconnectSummary = [];
  }
  seat.isReady = true;
  room.version += 1;
  if (room.engine?.state?.seats?.[seatIndex]) {
    const engineSeat = room.engine.state.seats[seatIndex];
    engineSeat.connectionStatus = status;
    engineSeat.autopilot = seat.autopilot;
    engineSeat.disconnectedAt = seat.disconnectedAt;
    engineSeat.reconnectSummary = [];
  }
}

function applyHostTransfer(room) {
  if (!room?.seats?.length) return;
  const hostStillSeated = room.seats.some((seat) => seat.type === "human" && seat.userId === room.hostUserId);
  if (hostStillSeated) return;
  const replacement = room.seats.find((seat) => seat.type === "human");
  room.hostUserId = replacement?.userId || null;
}

function reconcileRoomPresence(room) {
  const now = nowMs();
  for (const seat of room.seats || []) {
    if (seat.type !== "human" || !seat.lastSeenAt) continue;
    const last = Date.parse(seat.lastSeenAt);
    if (!Number.isFinite(last)) continue;
    if (now - last > ROOM_PRESENCE_TIMEOUT_MS && seat.userId) {
      if (seat.connectionStatus === "online") {
        seat.connectionStatus = "disconnected";
        seat.disconnectedAt = nowIsoString();
        seat.autopilot = false;
        if (room.engine?.state?.seats?.[seat.index]) {
          room.engine.state.seats[seat.index].connectionStatus = seat.connectionStatus;
          room.engine.state.seats[seat.index].autopilot = false;
          room.engine.state.seats[seat.index].disconnectedAt = seat.disconnectedAt;
          room.engine.state.seats[seat.index].reconnectSummary = seat.reconnectSummary || [];
        }
      } else if (seat.connectionStatus === "disconnected") {
        const disconnectedAt = Date.parse(seat.disconnectedAt || seat.lastSeenAt);
        if (Number.isFinite(disconnectedAt) && room.status !== "lobby" && now - disconnectedAt > DISCONNECT_GRACE_MS) {
          seat.connectionStatus = "autopilot";
          seat.autopilot = true;
          seat.isReady = true;
          seat.disconnectedAt = seat.disconnectedAt || nowIsoString();
          seat.reconnectSummary = Array.isArray(seat.reconnectSummary) ? seat.reconnectSummary : [];
          if (room.engine?.state?.seats?.[seat.index]) {
            room.engine.state.seats[seat.index].connectionStatus = seat.connectionStatus;
            room.engine.state.seats[seat.index].autopilot = true;
            room.engine.state.seats[seat.index].disconnectedAt = seat.disconnectedAt;
            room.engine.state.seats[seat.index].reconnectSummary = seat.reconnectSummary;
          }
        }
      }
    }
  }
  applyHostTransfer(room);
}

function randomId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function normalizeDisplayName(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 60) : "Guest";
}

function normalizeSeatMode(value) {
  if (value === "classic_4" || value === "six_6" || value === "auto") {
    return value;
  }
  return "auto";
}

function toBool(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

function normalizeInt(value, defaultValue = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  return Math.trunc(num);
}

function getRequestHost(req) {
  return String(req?.headers?.host || "").trim().toLowerCase();
}

function isAllowedOrigin(req) {
  const origin = String(req?.headers?.origin || "").trim();
  if (!origin) {
    return true;
  }
  const requestOrigin = origin.toLowerCase();
  if (!REQUIRE_ORIGIN_CHECK) {
    return true;
  }
  if (ALLOWED_ORIGINS.length > 0) {
    return ALLOWED_ORIGINS.includes(requestOrigin);
  }
  const host = getRequestHost(req);
  if (!host) {
    return false;
  }
  try {
    const parsedOrigin = new URL(requestOrigin);
    return parsedOrigin.origin === `https://${host}` || parsedOrigin.origin === `http://${host}`;
  } catch (error) {
    return false;
  }
}

function chooseSeatCount(tableMode, humanCount) {
  if (tableMode === "classic_4") return 4;
  if (tableMode === "six_6") return 6;
  return humanCount <= 4 ? 4 : 6;
}

function getBotDisplayNameFromIndex(index = 0) {
  const seed = Number.isFinite(Number(index)) ? Math.abs(Math.trunc(index)) : 0;
  const label = BOT_DISPLAY_NAMES[seed % BOT_DISPLAY_NAMES.length];
  if (label) return label;
  return `Bot ${seed + 1}`;
}

function getProfileSeatCount(profileId) {
  if (profileId === "six_304_36") return 6;
  return 4;
}

function resolveTableModeForProfile(profileId, tableMode) {
  if (profileId === "six_304_36") return "six_6";
  if (profileId === "classic_304_4p" && tableMode === "auto") return "classic_4";
  return tableMode;
}

function resolveRoom(roomRef) {
  if (!roomRef) return null;
  if (rooms.has(roomRef)) {
    return rooms.get(roomRef);
  }
  const codeRef = String(roomRef).toUpperCase();
  const roomId = roomsByCode.get(codeRef);
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function loadEngineModule() {
  if (!engineModulePromise) {
    engineModulePromise = import(ENGINE_MODULE);
  }
  return engineModulePromise;
}

function loadProfilesModule() {
  if (!profilesModulePromise) {
    profilesModulePromise = import(PROFILES_MODULE);
  }
  return profilesModulePromise;
}

function getRateLimitKey(sessionToken, scope) {
  return `${scope}::${sessionToken || "anon"}`;
}

function getClientAddress(req) {
  if (TRUST_PROXY) {
    const header = req?.headers?.["x-forwarded-for"];
    if (typeof header === "string" && header.trim()) {
      return header.split(",")[0].trim();
    }
  }
  return req?.socket?.remoteAddress || "unknown";
}

function getRateLimitKeyWithContext(req, sessionToken, scope) {
  const token = sanitizeSessionToken(sessionToken) || "anon";
  return `${scope}::${token}::${getClientAddress(req)}`;
}

function consumeRateLimit(req, sessionToken, scope) {
  const rule = ROOM_RATE_LIMITS[scope];
  if (!rule) return true;
  const bucket = getRateLimitKeyWithContext(req, sessionToken, scope);
  const now = nowMs();
  const list = (rateLimits.get(bucket) || []).filter((ts) => now - ts < rule.windowMs);
  if (list.length >= rule.limit) {
    rateLimits.set(bucket, list);
    return false;
  }
  list.push(now);
  rateLimits.set(bucket, list);
  return true;
}

function getSessionToken(req) {
  return sanitizeSessionToken(req.headers["x-session-token"]);
}

function sanitizeSessionToken(token) {
  const text = String(token || "").trim();
  if (!text || text.length > MAX_SESSION_TOKEN_LEN) {
    return "";
  }
  return /^[A-Za-z0-9._-]+$/.test(text) ? text : "";
}

function getSession(req, optional = false) {
  const token = getSessionToken(req);
  const session = token ? sessions.get(token) : null;
  if (!session && !optional) {
    return null;
  }
  if (session) {
    session.lastSeenAt = new Date().toISOString();
  }
  return session;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] || "");
    if (!/^application\/json/i.test(contentType) && !/^text\/json/i.test(contentType)) {
      reject(new Error("Unsupported media type"));
      return;
    }
    const chunks = [];
    let totalBytes = 0;
    req.on("data", (chunk) => {
      if (req.destroyed) {
        return;
      }
      totalBytes += chunk.length;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        const parseError = new Error("Invalid JSON");
        reject(parseError);
      }
    });
    req.on("error", () => {
      reject(new Error("Failed to read request body"));
    });
  });
}

function buildJoinUrl(inviteCode) {
  const code = String(inviteCode || "").trim().toUpperCase();
  if (!code) return "";
  return `/?room=${encodeURIComponent(code)}`;
}

function projectReconnectSummaryForPublic(summary) {
  if (!Array.isArray(summary)) return [];
  return summary.slice(-12).flatMap((action) => {
    if (!action || typeof action !== "object") return [];
    const projected = {
      type: action.type,
      at: action.at,
      handNumber: action.handNumber,
      phase: action.phase,
    };
    if (action.type === "BID" && Number.isFinite(action.amount)) {
      projected.amount = action.amount;
    }
    if (action.type === "PLAY_CARD") {
      const concealed = action.faceDown === true || action.fromIndicator === true;
      if (concealed) {
        projected.faceDown = true;
      } else if (typeof action.cardId === "string" && action.cardId) {
        projected.cardId = action.cardId;
      }
    }
    return [projected];
  });
}

function makeRoomResponse(room, seatIndex = null, session = null) {
  const isHost = !!(session && room.hostUserId === session.userId);
  return {
    roomId: room.id,
    inviteCode: room.inviteCode,
    joinUrl: buildJoinUrl(room.inviteCode),
    visibility: room.visibility,
    status: room.status,
    tableSizeMode: room.tableSizeMode,
    activeSeatCount: room.activeSeatCount,
    ruleProfileId: room.ruleProfileId,
    botDifficulty: room.botDifficulty,
    enableSecondBidding: room.enableSecondBidding,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    seatIndex,
    isHost,
    seats: room.seats.map((seat) => ({
      index: seat.index,
      team: seat.team,
      type: seat.type,
      displayName: seat.displayName,
      isMe: session ? seat.userId === session.userId : false,
      handSize: seat.handSize || 0,
      connectionStatus: seat.connectionStatus || "disconnected",
      autopilot: !!seat.autopilot,
      disconnectedAt: seat.disconnectedAt || null,
      reconnectSummary: projectReconnectSummaryForPublic(seat.reconnectSummary),
      isReady: seat.isReady || false,
    })),
  };
}

function sanitizeRoomForSeat(room, viewerSeat, session) {
  const base = makeRoomResponse(room, viewerSeat, session);
  if (!room.engine) {
    return {
      ...base,
      phase: "setup",
      publicState: null,
      seatView: null,
      legalActions: [],
      version: room.version || 0,
      handResult: null,
    };
  }
  const fullSeatView = viewerSeat == null ? null : room.engine.getSeatView(viewerSeat);
  const publicState = room.engine.getPublicState(viewerSeat);
  const legalActions = viewerSeat == null ? [] : room.engine.getLegalActions(viewerSeat);
  return {
    ...base,
    phase: room.engine.state.phase,
    publicState,
    seatView: fullSeatView,
    legalActions,
    version: room.engine.state.version,
    handResult: publicState.handResult,
    isMatchComplete: room.engine.state.phase === "match_complete",
  };
}

function getSeatIndexFromSession(room, session) {
  if (!room || !session) return null;
  return room.participants.get(session.sessionToken) ?? null;
}

function getPublicRoomEventLog(room, viewerSeat) {
  const rawLog = room.engine?.state?.actionLog || [];
  return rawLog.map((event) => {
    if (!event || typeof event !== "object") {
      return event;
    }
    const payload =
      event.payload && typeof event.payload === "object"
        ? { ...event.payload }
        : event.payload;
    if (event.type === "TRUMP_SELECTED") {
      const actorSeat = Number.isInteger(payload?.seat)
        ? payload.seat
        : event.seat;
      if (actorSeat !== viewerSeat) {
        return {
          ...event,
          payload: {
            seat: actorSeat,
            source: payload?.source,
          },
        };
      }
      return {
        ...event,
        payload,
      };
    }
    if (event.type !== "PLAY") {
      return { ...event, payload };
    }
    const actorSeat = event.seat;
    if (actorSeat === viewerSeat) {
      return { ...event, payload };
    }
    const publicPayload = { ...payload };
    delete publicPayload.cardId;
    delete publicPayload.faceDown;
    delete publicPayload.fromIndicator;
    return {
      ...event,
      payload: publicPayload,
    };
  });
}

function buildPublicRoomSummary(room) {
  const humanCount = room.seats.filter((seat) => seat.type === "human").length;
  const maxHumans = room.seats.length;
  const hasOpenSeat = room.seats.some((seat) => seat.type === "empty" || seat.type === "bot");
  const hasReadyHuman = room.seats.some((seat) => seat.type === "human" && seat.isReady);
  const createdAt = room.createdAt || nowIsoString();
  const updatedAt = room.updatedAt || createdAt;
  return {
    roomId: room.id,
    inviteCode: room.inviteCode,
    joinUrl: buildJoinUrl(room.inviteCode),
    tableSizeMode: room.tableSizeMode,
    ruleProfileId: room.ruleProfileId,
    botDifficulty: room.botDifficulty,
    enableSecondBidding: room.enableSecondBidding,
    status: room.status,
    humanCount,
    maxHumans,
    hasOpenSeat,
    hasReadyHuman,
    createdAt,
    updatedAt,
  };
}

function listPublicRooms() {
  return [...rooms.values()]
    .filter((room) => room.active)
    .filter((room) => room.visibility === "public")
    .filter((room) => room.status === "lobby")
    .sort((a, b) => {
      const aMs = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const bMs = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return bMs - aMs;
    })
    .map((room) => buildPublicRoomSummary(room));
}

function createRoomSummary(room, viewerSeat = null, session = null) {
  return sanitizeRoomForSeat(room, viewerSeat, session);
}

function createEmptySession(displayName) {
  const now = nowIsoString();
  const session = {
    userId: randomId("usr"),
    sessionToken: randomId("sess"),
    displayName,
    lastRoomId: null,
    lastRoomCode: null,
    createdAt: now,
    lastSeenAt: now,
  };
  sessions.set(session.sessionToken, session);
  return session;
}

function rememberSessionRoom(session, room) {
  if (!session || !room) return;
  session.lastRoomId = room.id;
  session.lastRoomCode = room.inviteCode;
  session.lastSeenAt = nowIsoString();
}

function nextInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = "304-";
    for (let i = 0; i < 12; i++) {
      code += chars[crypto.randomInt(chars.length)];
    }
    if (!roomsByCode.has(code)) {
      return code;
    }
  }
  throw new Error("Unable to allocate a unique invite code");
}

function createRoomObject({
  hostSession,
  visibility,
  tableSizeMode,
  ruleProfileId,
  botDifficulty,
  humanCount,
  enableSecondBidding = true,
}) {
  const activeSeatCount = chooseSeatCount(tableSizeMode, humanCount);
  const now = nowIsoString();
  const seats = [];
  const playerCount = activeSeatCount;
  for (let i = 0; i < playerCount; i++) {
    const isHost = i === 0;
    const isHostSeat = isHost;
    seats.push({
      index: i,
      team: i % 2 === 0 ? "A" : "B",
      type: isHost ? "human" : "empty",
      displayName: isHost ? hostSession.displayName : "",
      userId: isHostSeat ? hostSession.userId : null,
      sessionToken: isHostSeat ? hostSession.sessionToken : null,
      lastSeenAt: isHostSeat ? nowIsoString() : null,
      connectionStatus: isHost ? "online" : "disconnected",
      autopilot: false,
      disconnectedAt: null,
      reconnectSummary: [],
      isReady: isHost,
    });
  }
  const room = {
    id: randomId("room"),
    inviteCode: nextInviteCode(),
    hostUserId: hostSession.userId,
    visibility,
    status: "lobby",
    tableSizeMode,
    activeSeatCount,
    ruleProfileId,
    botDifficulty,
    enableSecondBidding,
    createdAt: now,
    updatedAt: now,
    version: 0,
    active: true,
    botRunner: {
      timerId: null,
      running: false,
      schedulePending: false,
    },
    engine: null,
    seats,
    participants: new Map(),
  };
  room.participants.set(hostSession.sessionToken, 0);
  rooms.set(room.id, room);
  roomsByCode.set(room.inviteCode, room.id);
  return room;
}

function getViewerSeat(room, session) {
  if (!room || !session) return null;
  return room.participants.get(session.sessionToken) ?? null;
}

function makeRoomJoinFailureDetails(roomRef) {
  if (roomRef.tableSizeMode === "classic_4") {
    return {
      code: "classic_4_full",
      tableSizeMode: roomRef.tableSizeMode,
      maxHumans: 4,
      recommendation: "switch_table_size",
    };
  }
  return {
    code: "room_full",
    tableSizeMode: roomRef.tableSizeMode,
    maxHumans: roomRef.activeSeatCount || roomRef.seats.length,
    recommendation: "seat_unavailable",
  };
}

function seatIsUsableForSeat(room, seatIndex, session) {
  const seat = room.seats[seatIndex];
  if (!seat) return false;
  if (seat.type === "empty") return true;
  if (seat.type === "bot") return true;
  if (seat.userId && session?.userId === seat.userId) return true;
  return false;
}

function buildSeatsFromRoom(room, forceFillBots = false) {
  return room.seats.map((seat, index) => {
    if (forceFillBots && seat.type === "empty") {
      return {
        seatLabel: `Seat ${index}`,
        index,
        team: index % 2 === 0 ? "A" : "B",
        type: "bot",
        connectionStatus: "online",
        autopilot: false,
        disconnectedAt: null,
        reconnectSummary: [],
        difficulty: room.botDifficulty,
        displayName: seat.displayName || getBotDisplayNameFromIndex(index),
      };
    }
    return {
      seatLabel: `Seat ${index}`,
      index,
      team: seat.team || (index % 2 === 0 ? "A" : "B"),
      type: seat.type,
      connectionStatus: seat.connectionStatus || (seat.type === "human" ? "disconnected" : "online"),
      autopilot: !!seat.autopilot,
      disconnectedAt: seat.disconnectedAt || null,
      reconnectSummary: Array.isArray(seat.reconnectSummary) ? seat.reconnectSummary : [],
      difficulty: seat.difficulty || room.botDifficulty,
      displayName: seat.displayName,
      userId: seat.userId,
      botId: seat.botId,
    };
  });
}

function fillBotSeats(room) {
  for (const seat of room.seats) {
    if (seat.type === "empty") {
      seat.type = "bot";
      seat.botId = randomId("bot");
      seat.difficulty = room.botDifficulty;
      seat.displayName = getBotDisplayNameFromIndex(seat.index);
      seat.userId = null;
      seat.autopilot = false;
      seat.disconnectedAt = null;
      seat.reconnectSummary = [];
      seat.connectionStatus = "online";
    }
    seat.isReady = true;
  }
}

function getBotDelayConfig(seatInfo = {}, room = {}) {
  const profile = (seatInfo?.difficulty || room.botDifficulty || "easy").toLowerCase();
  if (profile === "normal") return BOT_THINKING_DELAY_MS.normal;
  if (profile === "strong") return BOT_THINKING_DELAY_MS.strong;
  return BOT_THINKING_DELAY_MS.easy;
}

function getRandomIntInRange(min, max) {
  const low = Math.max(0, Number.isFinite(min) ? Math.floor(min) : 0);
  const high = Math.max(low, Number.isFinite(max) ? Math.floor(max) : low);
  return low === high ? low : low + Math.floor(Math.random() * (high - low + 1));
}

function getBotThinkDelayMs(room, seatInfo, phase) {
  const config = getBotDelayConfig(seatInfo, room);
  let minDelay = Number(config.min);
  let maxDelay = Number(config.max);
  if (!Number.isFinite(minDelay) || !Number.isFinite(maxDelay) || maxDelay < minDelay) {
    minDelay = 700;
    maxDelay = 3500;
  }
  if (seatInfo?.autopilot) {
    minDelay = Math.round(minDelay * BOT_AUTOPILOT_DELAY_FACTOR);
    maxDelay = Math.round(maxDelay * BOT_AUTOPILOT_DELAY_FACTOR);
  }
  if (maxDelay < minDelay) {
    maxDelay = minDelay;
  }
  // trump choice/bid selection can feel a bit faster than longer gameplay steps
  if (phase === "trump_choice" || phase === "trump_selection") {
    minDelay = Math.max(500, Math.round(minDelay * 0.85));
    maxDelay = Math.max(minDelay + 200, Math.round(maxDelay * 0.85));
  }
  return getRandomIntInRange(minDelay, maxDelay);
}

function clearBotRunnerTimer(room) {
  if (!room?.botRunner) return;
  if (room.botRunner.timerId) {
    clearTimeout(room.botRunner.timerId);
  }
  room.botRunner.timerId = null;
  room.botRunner.schedulePending = false;
  room.botRunner.running = false;
}

function appendAutopilotSummary(room, seatIndex, action, state, phase) {
  const roomSeat = room.seats?.[seatIndex];
  const seatState = state.seats?.[seatIndex];
  const actionSummary = {
    type: action.type,
    at: new Date().toISOString(),
    handNumber: state.handNumber,
    phase,
  };
  if (action.amount != null) {
    actionSummary.amount = action.amount;
  }
  if (action.cardId) {
    actionSummary.cardId = action.cardId;
  }
  if (action.faceDown) {
    actionSummary.faceDown = true;
  }
  if (action.fromIndicator) {
    actionSummary.fromIndicator = true;
  }
  if (roomSeat) {
    roomSeat.reconnectSummary = Array.isArray(roomSeat.reconnectSummary) ? roomSeat.reconnectSummary : [];
    roomSeat.reconnectSummary.push(actionSummary);
    if (roomSeat.reconnectSummary.length > 12) {
      roomSeat.reconnectSummary = roomSeat.reconnectSummary.slice(-12);
    }
  }
  if (Array.isArray(seatState?.reconnectSummary)) {
    seatState.reconnectSummary.push(actionSummary);
    if (seatState.reconnectSummary.length > 12) {
      seatState.reconnectSummary = seatState.reconnectSummary.slice(-12);
    }
  }
}

function isBotTurnState(state) {
  if (!state) return false;
  return (
    state.phase === "four_bidding" ||
    state.phase === "second_bidding" ||
    state.phase === "trump_selection" ||
    state.phase === "trump_choice" ||
    state.phase === "trick_play"
  );
}

function getCurrentBotSeat(room) {
  if (!room?.engine) return null;
  const state = room.engine.state;
  if (!isBotTurnState(state)) return null;
  const activeSeat = state.activeSeat;
  if (activeSeat == null) return null;
  const activeSeatInfo = state.seats?.[activeSeat];
  if (!activeSeatInfo || (activeSeatInfo.type !== "bot" && !activeSeatInfo.autopilot)) return null;
  return {
    seatIndex: activeSeat,
    seatInfo: activeSeatInfo,
    phase: state.phase,
  };
}

function executeOneBotAction(room) {
  if (!room?.engine || !room.botRunner) {
    return;
  }
  if (room.botRunner.running) return;
  room.botRunner.running = true;
  try {
    const slot = getCurrentBotSeat(room);
    if (!slot) return;

    const action = room.engine.getBotAction(slot.seatIndex);
    if (!action) return;

    const beforeState = room.engine.state;
    const applied = room.engine.applyAction(action);
    if (!applied.ok) return;

    if (slot.seatInfo?.autopilot) {
      appendAutopilotSummary(room, slot.seatIndex, action, beforeState, slot.phase);
    }

    room.updatedAt = nowIsoString();
    room.version = room.engine.state.version;
  } finally {
    room.botRunner.running = false;
  }
  runBotsUntilStable(room);
}

async function buildRoomEngine(room) {
  const { GameEngine } = await loadEngineModule();
  const humanSeats = room.seats.filter((seat) => seat.type === "human").length;
  const initialSeats = buildSeatsFromRoom(room, true);
  const hostSeat = room.seats[0] || { displayName: "Host" };
  const engine = new GameEngine({
    playerName: hostSeat.displayName || "Host",
    humanCount: Math.max(1, humanSeats),
    tableMode: room.tableSizeMode,
    ruleProfile: room.ruleProfileId,
    botDifficulty: room.botDifficulty,
    enableSecondBidding: room.enableSecondBidding,
    initialSeats,
  });
  engine.startMatch();
  return engine;
}

function runBotsUntilStable(room) {
  if (!room?.engine || !room.botRunner) {
    return;
  }
  if (room.botRunner.schedulePending || room.botRunner.running) {
    return;
  }
  const slot = getCurrentBotSeat(room);
  if (!slot) return;
  const delayMs = getBotThinkDelayMs(room, slot.seatInfo, slot.phase);
  room.botRunner.schedulePending = true;
  room.botRunner.timerId = setTimeout(() => {
    room.botRunner.timerId = null;
    room.botRunner.schedulePending = false;
    executeOneBotAction(room);
  }, delayMs);
}

function stopBotRunner(room) {
  clearBotRunnerTimer(room);
  if (!room?.botRunner) return;
  room.botRunner.running = false;
  room.botRunner.schedulePending = false;
}

async function apiRooms(req, res, method, roomRef, action, query) {
  const session = getSession(req, true);
  reconcileRoomPresence(roomRef);

  if (!action) {
    if (method === "GET") {
      if (!session) {
        return writeError(res, 401, "Session required");
      }
      const seat = getViewerSeat(roomRef, session);
      if (!Number.isFinite(seat)) {
        return writeError(res, 403, "You are not seated in this room");
      }
      touchSeatPresence(roomRef, seat);
      return writeJson(res, 200, createRoomSummary(roomRef, seat, session));
    }
    return writeError(res, 405, "Method not allowed");
  }

  if (action === "events") {
    if (method !== "GET") {
      return writeError(res, 405, "Method not allowed");
    }
    if (!session) {
      return writeError(res, 401, "Session required");
    }
    if (!consumeRateLimit(req, session.sessionToken, "events")) {
      return writeError(res, 429, "Rate limit exceeded");
    }
    const viewerSeat = getSeatIndexFromSession(roomRef, session);
    if (!Number.isFinite(viewerSeat)) {
      return writeError(res, 403, "You are not seated in this room");
    }
    return writeJson(res, 200, {
      roomId: roomRef.id,
      events: getPublicRoomEventLog(roomRef, viewerSeat),
      handNumber: roomRef.engine?.state?.handNumber || 0,
      phase: roomRef.engine?.state?.phase || "setup",
      version: roomRef.engine?.state?.version || roomRef.version || 0,
    });
  }

  if (action === "join") {
    if (method !== "POST") {
      return writeError(res, 405, "Method not allowed");
    }
    const token = getSessionToken(req);
    if (!token || !session) {
      return writeError(res, 401, "Session required");
    }
    if (!consumeRateLimit(req, token, "join_room")) {
      return writeError(res, 429, "Rate limit exceeded");
    }
    const existingSeat = roomRef.participants.get(token);
    if (typeof existingSeat === "number") {
      touchSeatPresence(roomRef, existingSeat);
      rememberSessionRoom(session, roomRef);
      return writeJson(res, 200, sanitizeRoomForSeat(roomRef, existingSeat, session));
    }
    if (roomRef.status !== "lobby") {
      return writeError(res, 409, "Room is not accepting joins now");
    }
    const payload = await parseJsonBody(req);
    const preferredSeat = normalizeInt(payload.seatIndex, NaN);

    const pickSeat = (() => {
      if (Number.isFinite(preferredSeat) && preferredSeat >= 0 && preferredSeat < roomRef.seats.length && seatIsUsableForSeat(roomRef, preferredSeat, session)) {
        return preferredSeat;
      }
      const candidate = roomRef.seats.findIndex((seat) => seatIsUsableForSeat(roomRef, seat.index, session));
      return candidate;
    })();

    if (pickSeat < 0) {
      const joinErrorDetails = makeRoomJoinFailureDetails(roomRef);
      if (joinErrorDetails.code === "classic_4_full") {
        return writeError(
          res,
          409,
          "This room is set to Classic 4-seat mode. Ask the host to switch to Six-player mode or join as spectator when spectator mode is available.",
          joinErrorDetails,
        );
      }
      return writeError(res, 409, "Room is full", joinErrorDetails);
    }

    const displayName = normalizeDisplayName(payload.displayName || session.displayName);
    const target = roomRef.seats[pickSeat];
    const currentType = target.type;
    target.type = "human";
    target.displayName = displayName;
    target.userId = session.userId;
    target.sessionToken = token;
    target.botId = null;
    target.lastSeenAt = nowIsoString();
    target.connectionStatus = "online";
    target.isReady = true;
    roomRef.participants.set(token, pickSeat);
    touchSeatPresence(roomRef, pickSeat);
    rememberSessionRoom(session, roomRef);
    roomRef.updatedAt = nowIsoString();
    roomRef.version += 1;

    if (currentType === "empty" || currentType === "bot") {
      // occupant replaced
    }
    return writeJson(res, 201, sanitizeRoomForSeat(roomRef, pickSeat, session));
  }

  if (action === "seat") {
    if (method !== "POST") {
      return writeError(res, 405, "Method not allowed");
    }
    if (!session) return writeError(res, 401, "Session required");
    const token = getSessionToken(req);
    if (!consumeRateLimit(req, token, "join_room")) {
      return writeError(res, 429, "Rate limit exceeded");
    }
    if (roomRef.status !== "lobby") {
      return writeError(res, 409, "Cannot change seats in active game");
    }
    const payload = await parseJsonBody(req);
    const preferredSeat = normalizeInt(payload.seatIndex, NaN);
    const existingSeat = roomRef.participants.get(token);
    if (!Number.isFinite(preferredSeat) || preferredSeat < 0 || preferredSeat >= roomRef.seats.length) {
      return writeError(res, 400, "Invalid seat index");
    }
    if (existingSeat === preferredSeat) {
      return writeJson(res, 200, sanitizeRoomForSeat(roomRef, preferredSeat, session));
    }
    const target = roomRef.seats[preferredSeat];
    if (!seatIsUsableForSeat(roomRef, preferredSeat, session)) {
      return writeError(res, 409, "Seat is not available");
    }
    if (typeof existingSeat === "number") {
      const current = roomRef.seats[existingSeat];
      if (current && current.userId === session.userId) {
        current.type = "empty";
        current.displayName = "";
        current.userId = null;
        current.sessionToken = null;
        current.lastSeenAt = null;
      }
      roomRef.participants.delete(token);
    }
    target.type = "human";
    target.userId = session.userId;
    target.sessionToken = token;
    target.displayName = normalizeDisplayName(payload.displayName || session.displayName);
    target.botId = null;
    target.lastSeenAt = nowIsoString();
    target.connectionStatus = "online";
    target.isReady = true;
    roomRef.participants.set(token, preferredSeat);
    touchSeatPresence(roomRef, preferredSeat);
    rememberSessionRoom(session, roomRef);
    roomRef.updatedAt = nowIsoString();
    roomRef.version += 1;
    return writeJson(res, 200, sanitizeRoomForSeat(roomRef, preferredSeat, session));
  }

  if (action === "ready") {
    if (method !== "POST") {
      return writeError(res, 405, "Method not allowed");
    }
    if (!session) {
      return writeError(res, 401, "Session required");
    }
    if (roomRef.status !== "lobby") {
      return writeError(res, 409, "Cannot ready outside lobby");
    }
    const viewerSeat = getViewerSeat(roomRef, session);
    if (!Number.isFinite(viewerSeat)) {
      return writeError(res, 403, "You are not seated in this room");
    }
    const payload = await parseJsonBody(req);
    const requested = payload?.isReady;
    const nextReady = typeof requested === "boolean" ? requested : !roomRef.seats[viewerSeat].isReady;
    roomRef.seats[viewerSeat].isReady = nextReady;
    touchSeatPresence(roomRef, viewerSeat);
    rememberSessionRoom(session, roomRef);
    return writeJson(res, 200, sanitizeRoomForSeat(roomRef, viewerSeat, session));
  }

  if (action === "heartbeat") {
    if (method !== "POST") {
      return writeError(res, 405, "Method not allowed");
    }
    if (!session) {
      return writeError(res, 401, "Session required");
    }
    const viewerSeat = getViewerSeat(roomRef, session);
    if (Number.isFinite(viewerSeat)) {
      touchSeatPresence(roomRef, viewerSeat);
    }
    return writeJson(res, 200, sanitizeRoomForSeat(roomRef, viewerSeat, session));
  }

  if (action === "start") {
    if (method !== "POST") {
      return writeError(res, 405, "Method not allowed");
    }
    const payload = await parseJsonBody(req);
    const forceStart = toBool(payload?.forceStart);
    if (!session) {
      return writeError(res, 401, "Session required");
    }
    if (!consumeRateLimit(req, session.sessionToken, "start_room")) {
      return writeError(res, 429, "Rate limit exceeded");
    }
    applyHostTransfer(roomRef);
    if (roomRef.hostUserId !== session.userId) {
      return writeError(res, 403, "Only host can start");
    }
    const humanSeats = roomRef.seats.filter((seat) => seat.type === "human").length;
    if (humanSeats < 1) {
      return writeError(res, 409, "Need at least one player to start");
    }
    const expectedSeatCount = getProfileSeatCount(roomRef.ruleProfileId);
    if (roomRef.seats.length !== expectedSeatCount) {
      return writeError(
        res,
        409,
        "Room configuration does not match selected rule profile.",
        {
          code: "profile_seat_count_mismatch",
          profileId: roomRef.ruleProfileId,
          expectedSeatCount,
          actualSeatCount: roomRef.seats.length,
        },
      );
    }
    const unreadyHumanSeats = roomRef.seats
      .filter((seat) => seat.type === "human")
      .filter((seat) => !seat.isReady || seat.connectionStatus === "disconnected")
      .map((seat) => ({
        index: seat.index,
        displayName: seat.displayName,
        isReady: !!seat.isReady,
        connectionStatus: seat.connectionStatus || "disconnected",
      }));
    if (unreadyHumanSeats.length > 0 && !forceStart) {
      return writeError(res, 409, "Some players are not ready", {
        requiresForceStart: true,
        unreadyHumanSeats,
      });
    }
    if (!roomRef.engine) {
      fillBotSeats(roomRef);
      roomRef.engine = await buildRoomEngine(roomRef);
      rememberSessionRoom(session, roomRef);
      roomRef.status = "in_hand";
      roomRef.active = true;
      runBotsUntilStable(roomRef);
    }
    return writeJson(res, 200, sanitizeRoomForSeat(roomRef, getViewerSeat(roomRef, session), session));
  }

  if (action === "state") {
    if (method !== "GET") {
      return writeError(res, 405, "Method not allowed");
    }
    if (!session) {
      return writeError(res, 401, "Session required");
    }
    const viewerSeat = getViewerSeat(roomRef, session);
    if (!Number.isFinite(viewerSeat)) {
      return writeError(res, 403, "You are not seated in this room");
    }
    touchSeatPresence(roomRef, viewerSeat);
    return writeJson(res, 200, sanitizeRoomForSeat(roomRef, viewerSeat, session));
  }

  if (action === "actions") {
    if (method !== "POST") {
      return writeError(res, 405, "Method not allowed");
    }
    if (!session) {
      return writeError(res, 401, "Session required");
    }
    if (!roomRef.engine) {
      return writeError(res, 409, "Game has not started");
    }
    if (!consumeRateLimit(req, session.sessionToken, "room_action")) {
      return writeError(res, 429, "Rate limit exceeded");
    }
    const viewerSeat = getViewerSeat(roomRef, session);
    if (!Number.isFinite(viewerSeat)) {
      return writeError(res, 403, "You are not seated in this room");
    }
    const payload = await parseJsonBody(req);
    const action = {
      ...payload,
      actorSeatIndex: Number.isFinite(payload.actorSeatIndex) ? payload.actorSeatIndex : viewerSeat,
      seatIndex: Number.isFinite(payload.seatIndex) ? payload.seatIndex : viewerSeat,
    };
    if (action.actorSeatIndex !== viewerSeat || action.seatIndex !== viewerSeat) {
      return writeError(res, 403, "Seat mismatch");
    }
    const seat = roomRef.seats[viewerSeat];
    if (seat.type !== "human" || seat.userId !== session.userId) {
      return writeError(res, 403, "Seat no longer available");
    }
    if (seat.connectionStatus !== "online") {
      return writeError(res, 409, "Seat is not currently active");
    }
    touchSeatPresence(roomRef, viewerSeat);

    const result = roomRef.engine.applyAction(action);
    if (!result.ok) {
      return writeError(res, 409, result.reason || "Action rejected");
    }
    roomRef.version = roomRef.engine.state.version;
    roomRef.updatedAt = new Date().toISOString();
    runBotsUntilStable(roomRef);
    return writeJson(res, 200, sanitizeRoomForSeat(roomRef, viewerSeat, session));
  }

  return writeError(res, 404, "Unknown room action");
}

async function requestHandler(req, res) {
  const requestId = randomId("req");
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Service-Name", APP_NAME);
  res.setHeader("X-Service-Version", APP_VERSION);
  res.setHeader("X-Environment", NODE_ENV);
  const requestUrl = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (requestUrl.pathname === "/health" || requestUrl.pathname === "/healthz") {
    writeHealth(res);
    return;
  }

  if (requestUrl.pathname === "/ready" || requestUrl.pathname === "/readyz") {
    writeJson(res, 200, {
      name: APP_NAME,
      version: APP_VERSION,
      env: NODE_ENV,
      status: "ready",
      requestId,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (!requestUrl.pathname.startsWith("/api/")) {
    const filePath = resolveFile(requestUrl.pathname);
    if (!filePath) {
      writeError(res, 404, "Not found");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      writeError(res, 405, "Method not allowed");
      return;
    }
    writeResponse(filePath, req.method, res);
    return;
  }

  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const method = req.method || "GET";
  const segment = parts[1];
  const methodRequiresOriginCheck = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if ((segment || "").startsWith("api") || requestUrl.pathname.startsWith("/api/")) {
    if (method === "OPTIONS") {
      if (!isAllowedOrigin(req)) {
        writeError(res, 403, "Origin denied");
        return;
      }
      if (req.headers.origin) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "content-type, x-session-token");
        res.setHeader("Vary", "Origin");
      }
      res.statusCode = 204;
      applySecurityHeaders(res);
      res.end();
      return;
    }

    if (methodRequiresOriginCheck && !isAllowedOrigin(req)) {
      writeError(res, 403, "Origin denied");
      return;
    }
  }

  if (segment === "guest-session" && method === "POST") {
    if (!consumeRateLimit(req, null, "guest_session")) {
      return writeError(res, 429, "Rate limit exceeded");
    }
    const body = await parseJsonBody(req);
    const displayName = normalizeDisplayName(body.displayName || "Guest");
    const session = createEmptySession(displayName);
    writeJson(res, 201, {
      userId: session.userId,
      sessionToken: session.sessionToken,
      displayName: session.displayName,
    });
    return;
  }

  if (segment === "rule-profiles" && method === "GET") {
    const profilesModule = await loadProfilesModule();
    const { GAME_PROFILES } = profilesModule;
    const cardCounts = {
      classic_304_4p: 32,
      six_304_36: 36,
    };
    const profiles = Object.values(GAME_PROFILES || {}).map((profile) => ({
      id: profile.id,
      name: profile.name,
      seatCount: profile.seatCount,
      cardCount: cardCounts[profile.id] || profile.deckRanks.length * profile.seatCount || 0,
      description: `${profile.seatCount} players`,
    }));
    writeJson(res, 200, { profiles });
    return;
  }

  if (segment === "rooms") {
    if (parts.length === 2) {
      if (method === "POST") {
        const session = getSession(req, true);
        if (!session) {
          return writeError(res, 401, "Session required");
        }
        if (!consumeRateLimit(req, session.sessionToken, "create_room")) {
          return writeError(res, 429, "Rate limit exceeded");
        }
        if (rooms.size >= MAX_ROOMS_IN_MEMORY) {
          return writeError(res, 503, "Server at capacity");
        }
        const payload = await parseJsonBody(req);
        const visibility = payload.visibility === "public" ? "public" : "private";
        const tableSizeMode = normalizeSeatMode(payload.tableSizeMode);
        const ruleProfileId = normalizeDisplayName(payload.ruleProfileId || "classic_304_4p");
        const botDifficulty = payload.botDifficulty === "strong" || payload.botDifficulty === "normal" ? payload.botDifficulty : "easy";
        const humanCount = normalizeInt(payload.humanCount || 1, 1);
        const enableSecondBidding = toBool(payload.enableSecondBidding);

        const profilesModule = await loadProfilesModule();
        const profile = profilesModule.GAME_PROFILES?.[ruleProfileId] || profilesModule.GAME_PROFILES?.classic_304_4p;
        if (!profile) {
          return writeError(res, 400, "Unknown rule profile");
        }
        if (profile.id === "classic_304_4p" && tableSizeMode === "six_6") {
          return writeError(res, 400, "classic_304_4p requires 4-seat configuration");
        }
        if (profile.id === "six_304_36" && tableSizeMode === "classic_4") {
          return writeError(res, 400, "six_304_36 requires 6-seat configuration");
        }
        if (profile.id === "classic_304_4p" && tableSizeMode === "auto" && humanCount > 4) {
          return writeError(
            res,
            409,
            "Auto table mode with 5-6 humans requires a six-seat profile. Choose six_304_36.",
            {
              code: "profile_table_mismatch",
              profileId: profile.id,
              requestedTableMode: tableSizeMode,
              resolvedTableMode: "classic_4",
              maxHumans: 4,
              requestedHumanCount: humanCount,
            },
          );
        }

        const resolvedTableMode = resolveTableModeForProfile(profile.id, tableSizeMode);
        const maxSeats = resolvedTableMode === "six_6" ? 6 : 4;
        const cappedHumanCount = Math.min(Math.max(humanCount, 1), maxSeats);

        const room = createRoomObject({
          hostSession: session,
          visibility,
          tableSizeMode: resolvedTableMode,
          ruleProfileId: profile.id,
          botDifficulty,
          humanCount: cappedHumanCount,
          enableSecondBidding,
        });
        rememberSessionRoom(session, room);
        writeJson(res, 201, createRoomSummary(room, 0, session));
        return;
      }
      if (method === "GET") {
        const roomsList = listPublicRooms().map((roomSummary) => ({
          ...roomSummary,
          isJoinable: roomSummary.hasOpenSeat,
        }));
        writeJson(res, 200, {
          rooms: roomsList,
          count: roomsList.length,
        });
        return;
      }
      return writeError(res, 405, "Method not allowed");
    }

    const room = resolveRoom(parts[2]);
    if (!room) {
      writeError(res, 404, "Room not found");
      return;
    }
    if (!room.active) {
      stopBotRunner(room);
      writeError(res, 410, "Room is no longer active");
      return;
    }
    if (
      room.status === "lobby" &&
      !room.seats.some((seat) => seat.type === "human") &&
      nowMs() - Date.parse(room.updatedAt || room.createdAt) > ROOM_GC_AFTER_MS
    ) {
      room.active = false;
      stopBotRunner(room);
      rooms.delete(room.id);
      roomsByCode.delete(room.inviteCode);
      writeError(res, 410, "Room has closed");
      return;
    }

    await apiRooms(req, res, method, room, parts[3]);
    return;
  }

  writeError(res, 404, "Unknown API endpoint");
}

const server = http.createServer(async (req, res) => {
  try {
    req.setTimeout(REQUEST_TIMEOUT_MS);
    await requestHandler(req, res);
  } catch (error) {
    console.error("[304-game] request error", { error: error?.message || "unknown" });
    if (error && error.message === "Payload too large") {
      writeError(res, 413, "Payload too large");
      return;
    }
    if (error && error.message === "Unsupported media type") {
      writeError(res, 415, "Unsupported media type");
      return;
    }
    if (error && error.message === "Request timeout") {
      writeError(res, 408, "Request timeout");
      return;
    }
    if (error && error.message === "Invalid JSON") {
      writeError(res, 400, "Invalid JSON");
      return;
    }
    writeError(res, 500, "Internal server error", error?.message || null);
  }
});

const activeSockets = new Set();
server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.once("close", () => {
    activeSockets.delete(socket);
  });
});

server.on("error", (error) => {
  console.error(`[304-game] server error`, { error: error?.message || "unknown" });
});

function cleanupExpiredInMemoryState() {
  const now = nowMs();
  const activeRateWindows = Object.values(ROOM_RATE_LIMITS).map((entry) => entry.windowMs);
  const maxRateWindow = Math.max(...activeRateWindows, 60 * 1000);

  for (const [roomId, room] of rooms.entries()) {
    if (!room || room.active !== false) {
      if (
        room.status === "lobby" &&
        !room.seats.some((seat) => seat.type === "human") &&
        now - Date.parse(room.updatedAt || room.createdAt) > ROOM_GC_AFTER_MS
      ) {
        stopBotRunner(room);
        rooms.delete(roomId);
        roomsByCode.delete(room.inviteCode);
      }
      continue;
    }
    if (now - Date.parse(room.updatedAt || room.createdAt) > ROOM_GC_AFTER_MS) {
      room.active = false;
      stopBotRunner(room);
      rooms.delete(roomId);
      roomsByCode.delete(room.inviteCode);
    }
  }

  for (const [token, session] of sessions.entries()) {
    if (!session.lastSeenAt) {
      sessions.delete(token);
      continue;
    }
    if (now - Date.parse(session.lastSeenAt) > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }

  if (sessions.size > MAX_SESSIONS_IN_MEMORY) {
    const sortedTokens = [...sessions.entries()]
      .sort(([, left], [, right]) => Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0))
      .slice(0, MAX_SESSIONS_IN_MEMORY);
    sessions.clear();
    for (const [token, session] of sortedTokens) {
      sessions.set(token, session);
    }
  }

  if (rooms.size > MAX_ROOMS_IN_MEMORY) {
    const recent = [...rooms.entries()]
      .sort(([, left], [, right]) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0))
      .slice(0, MAX_ROOMS_IN_MEMORY);
    const keepIds = new Set(recent.map(([roomId]) => roomId));
    for (const [roomId, room] of rooms.entries()) {
      if (!keepIds.has(roomId)) {
        stopBotRunner(room);
      }
    }
    rooms.clear();
    roomsByCode.clear();
    for (const [roomId, room] of recent) {
      rooms.set(roomId, room);
      roomsByCode.set(room.inviteCode, roomId);
    }
  }

  for (const [key, list] of rateLimits.entries()) {
    const clean = list.filter((ts) => now - ts < maxRateWindow);
    if (!clean.length) {
      rateLimits.delete(key);
    } else {
      rateLimits.set(key, clean);
    }
  }
}

setInterval(cleanupExpiredInMemoryState, CLEANUP_INTERVAL_MS).unref?.();

server.headersTimeout = Math.max(REQUEST_TIMEOUT_MS + 5000, 60000);
server.requestTimeout = REQUEST_TIMEOUT_MS + 1000;
server.keepAliveTimeout = 65_000;

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[304-game] shutdown requested by ${signal}`);
  for (const socket of activeSockets) {
    socket.destroy();
  }
  server.close(() => {
    console.log("[304-game] all connections closed");
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  console.error("[304-game] uncaughtException", { error: error?.message || "unknown" });
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("[304-game] unhandledRejection", { reason: reason?.message || reason });
});

server.listen(PORT, () => {
  console.log(`[304-game] ${APP_NAME} v${APP_VERSION} listening on http://localhost:${PORT} (${NODE_ENV})`);
});
