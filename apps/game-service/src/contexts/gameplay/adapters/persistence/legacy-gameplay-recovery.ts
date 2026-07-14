import { type EngineState, GameEngine } from "@three-zero-four/game-engine";
import type { StoredRoom } from "../../../rooms/application/room-persistence-model.js";
import type {
  RoomPersistenceStore,
  RoomTransaction,
} from "../../../rooms/application/room-persistence-store.js";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";
import {
  applyConnectionState,
  applyLobbySeat,
  isBotDifficulty,
} from "../engine/legacy-engine-seat-mapper.js";

type RecoveryStore = Pick<
  RoomPersistenceStore,
  "findSeatIndex" | "loadEventsAfter" | "loadSeats" | "loadSnapshot"
>;

export class LegacyGameplayRecovery {
  constructor(private readonly store: RecoveryStore) {}

  async recover(
    transaction: RoomTransaction,
    room: StoredRoom,
  ): Promise<GameEngine> {
    const snapshot = await this.store.loadSnapshot(room.id, transaction);
    if (!snapshot || snapshot.eventVersion > room.eventVersion) {
      throw new RecoveryError(room.id);
    }
    if (snapshot.ruleProfileId !== room.ruleProfileId) {
      throw new RecoveryError(room.id);
    }
    let engine = GameEngine.hydrate(
      structuredClone(snapshot.state) as EngineState,
    );
    const events = await this.store.loadEventsAfter(
      room.id,
      snapshot.eventVersion,
      transaction,
    );
    try {
      for (const event of events) {
        if (event.eventType === "ROOM_STARTED") {
          const payload = event.payload as Record<string, unknown>;
          const state = payload.state;
          if (!state || typeof state !== "object" || Array.isArray(state)) {
            throw new RecoveryError(room.id);
          }
          const started = GameEngine.hydrate(
            structuredClone(state) as EngineState,
          );
          const profile = started.state.profile;
          if (
            !profile ||
            typeof profile !== "object" ||
            Array.isArray(profile) ||
            (profile as Record<string, unknown>).id !== room.ruleProfileId
          ) {
            throw new RecoveryError(room.id);
          }
          engine = started;
          continue;
        }
        if (event.eventType === "PLAYER_JOINED") {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          const displayName = payload.displayName;
          if (
            typeof seatIndex !== "number" ||
            !Number.isInteger(seatIndex) ||
            typeof displayName !== "string" ||
            !event.actorPlayerId
          ) {
            throw new RecoveryError(room.id);
          }
          applyLobbySeat(engine, {
            seatIndex,
            playerId: event.actorPlayerId,
            occupantType: "human",
            botDifficulty: null,
            displayName,
          });
          continue;
        }
        if (event.eventType === "ROOM_CLOSED") {
          const payload = event.payload as Record<string, unknown>;
          if (
            payload.reason === "LOBBY_IDLE" ||
            payload.reason === "TERMINAL_RETENTION"
          ) {
            continue;
          }
        }
        if (
          event.eventType === "PLAYER_LEFT" ||
          event.eventType === "ROOM_CLOSED"
        ) {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          const replacement =
            payload.replacement ??
            (event.eventType === "ROOM_CLOSED" ? "empty" : null);
          const botDifficulty = isBotDifficulty(payload.botDifficulty)
            ? payload.botDifficulty
            : null;
          if (
            typeof seatIndex !== "number" ||
            !Number.isInteger(seatIndex) ||
            (replacement !== "empty" && replacement !== "bot") ||
            (replacement === "bot" && !botDifficulty)
          ) {
            throw new RecoveryError(room.id);
          }
          applyLobbySeat(engine, {
            seatIndex,
            playerId: null,
            occupantType: replacement,
            botDifficulty: replacement === "bot" ? botDifficulty : null,
            displayName: null,
            connectionStatus: replacement === "bot" ? "online" : "disconnected",
          });
          continue;
        }
        if (event.eventType === "GAME_ACTION") {
          if (!event.actorPlayerId) throw new RecoveryError(room.id);
          const payload = event.payload as Record<string, unknown>;
          const action = payload.action;
          if (!action || typeof action !== "object" || Array.isArray(action)) {
            throw new RecoveryError(room.id);
          }
          const seatIndex = await this.store.findSeatIndex(
            transaction,
            room.id,
            event.actorPlayerId,
          );
          if (seatIndex == null) throw new RecoveryError(room.id);
          const result = engine.applyAction({
            ...(action as Record<string, unknown>),
            seatIndex,
            actorSeatIndex: seatIndex,
          });
          if (!result.ok) throw new RecoveryError(room.id);
          continue;
        }
        if (event.eventType === "TRICK_ADVANCED") {
          const result = engine.advanceTrick();
          if (!result.ok) throw new RecoveryError(room.id);
          continue;
        }
        if (
          event.eventType === "PLAYER_DISCONNECTED" ||
          event.eventType === "PLAYER_RECONNECTED" ||
          event.eventType === "AUTOPILOT_ENABLED" ||
          event.eventType === "AUTOPILOT_CANCELLED"
        ) {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          if (typeof seatIndex !== "number" || !Number.isInteger(seatIndex)) {
            throw new RecoveryError(room.id);
          }
          applyConnectionState(
            engine,
            seatIndex,
            event.eventType === "PLAYER_DISCONNECTED"
              ? "disconnected"
              : event.eventType === "AUTOPILOT_ENABLED"
                ? "autopilot"
                : "online",
          );
          continue;
        }
        if (
          event.eventType === "BOT_ACTION" ||
          event.eventType === "AUTOPILOT_ACTION"
        ) {
          const payload = event.payload as Record<string, unknown>;
          const seatIndex = payload.seatIndex;
          const action = payload.action;
          if (
            typeof seatIndex !== "number" ||
            !Number.isInteger(seatIndex) ||
            !action ||
            typeof action !== "object" ||
            Array.isArray(action)
          ) {
            throw new RecoveryError(room.id);
          }
          const result = engine.applyAutomationAction(
            action as Record<string, unknown>,
            seatIndex,
          );
          if (!result.ok) throw new RecoveryError(room.id);
          continue;
        }
        if (event.eventType !== "ROOM_CREATED") {
          throw new RecoveryError(room.id);
        }
      }
      const seats = await this.store.loadSeats(room.id, transaction);
      for (const seat of seats) {
        applyConnectionState(
          engine,
          seat.seatIndex,
          seat.connectionStatus ?? "disconnected",
        );
      }
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      throw new RecoveryError(room.id);
    }
    return engine;
  }
}
