import type { RuleProfileId } from "@three-zero-four/contracts";
import { GameEngine } from "@three-zero-four/game-engine";
import {
  type BotDifficulty,
  type GameplaySeatRecord,
  toEngineSeat,
} from "./legacy-engine-seat-mapper.js";

export interface LegacyEngineSettings {
  readonly botDifficulty: BotDifficulty;
  readonly enableSecondBidding: boolean;
}

export interface LegacyEngineRoomRecord {
  readonly hostPlayerId: string;
  readonly ruleProfileId: RuleProfileId;
  readonly settings: LegacyEngineSettings;
}

export interface LegacyEngineHost {
  readonly displayName: string;
}

export function seatCountForProfile(ruleProfileId: RuleProfileId): 4 | 6 {
  return ruleProfileId === "six_304_36" ? 6 : 4;
}

function tableModeForProfile(
  ruleProfileId: RuleProfileId,
): "classic_4" | "six_6" {
  return ruleProfileId === "six_304_36" ? "six_6" : "classic_4";
}

export function createLobbyEngine(
  host: LegacyEngineHost,
  seats: readonly GameplaySeatRecord[],
  ruleProfileId: RuleProfileId,
  settings: LegacyEngineSettings,
): GameEngine {
  return new GameEngine({
    playerName: host.displayName,
    humanCount: seats.filter((seat) => seat.occupantType === "human").length,
    tableMode: tableModeForProfile(ruleProfileId),
    ruleProfile: ruleProfileId,
    botDifficulty: settings.botDifficulty,
    enableSecondBidding: settings.enableSecondBidding,
    initialSeats: seats.map(toEngineSeat),
  });
}

export function createStartedEngine(
  room: LegacyEngineRoomRecord,
  seats: readonly GameplaySeatRecord[],
): GameEngine {
  const host = seats.find((seat) => seat.playerId === room.hostPlayerId);
  const engine = new GameEngine({
    playerName: host?.displayName ?? "Host",
    humanCount: seats.filter((seat) => seat.occupantType === "human").length,
    tableMode: tableModeForProfile(room.ruleProfileId),
    ruleProfile: room.ruleProfileId,
    botDifficulty: room.settings.botDifficulty,
    enableSecondBidding: room.settings.enableSecondBidding,
    initialSeats: seats.map(toEngineSeat),
  });
  engine.startMatch();
  return engine;
}
