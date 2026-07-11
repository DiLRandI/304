export interface EngineCard {
  cardId: string;
  suit?: string;
  rank?: string;
  points?: number;
  hidden?: boolean;
}

export interface EngineSeat {
  index: number;
  type: "human" | "bot" | "empty";
  displayName?: string;
  userId?: string;
  difficulty?: string;
  connectionStatus?: string;
  hand?: EngineCard[];
  firstHand?: EngineCard[];
  wonCards?: EngineCard[];
  [key: string]: unknown;
}

export interface EngineState {
  seats: EngineSeat[];
  humanCount: number;
  phase: string;
  [key: string]: unknown;
}

export interface GameEngineOptions {
  playerName?: string;
  humanCount?: number;
  tableMode?: "auto" | "classic_4" | "six_6";
  ruleProfile?: "classic_304_4p" | "six_304_36";
  botDifficulty?: "easy" | "normal" | "strong";
  enableSecondBidding?: boolean;
  initialSeats?: EngineSeat[];
}

export class GameEngine {
  constructor(options?: GameEngineOptions);
  state: EngineState;
  startMatch(): void;
  getSnapshot(): EngineState;
  getPublicState(viewerSeatIndex?: number | null): Record<string, unknown>;
  getSeatView(
    viewerSeatIndex: number,
    seatIndex?: number,
  ): Record<string, unknown> | null;
  getPrompt(): string;
  getLegalActions(seatIndex: number): Array<Record<string, unknown>>;
  getBotAction(seatIndex: number): Record<string, unknown> | null;
  applyAutomationAction(
    action: Record<string, unknown>,
    seatIndex: number,
  ): { ok: boolean; reason?: string };
  applyAction(action: Record<string, unknown>): {
    ok: boolean;
    reason?: string;
  };
  static hydrate(snapshot: EngineState): GameEngine;
}

export function pickBotAction(
  state: Record<string, unknown>,
  seatIndex: number,
): Record<string, unknown> | null;
export function buildDeck(...args: unknown[]): EngineCard[];
export const CLASSIC_CARD_POINTS: Record<string, number>;
export const CLASSIC_DECK_RANKS: readonly string[];
export function cardId(card: EngineCard): string;
export function cloneCard(card: EngineCard): EngineCard;
export function compareCardsForTrick(...args: unknown[]): number;
export function compareRank(...args: unknown[]): number;
export function formatCard(card: EngineCard): string;
export function generateShuffleSeed(): string;
export function makeShuffleCommit(...args: unknown[]): string;
export const SUITS: readonly string[];
export function shuffleDeck(
  cards: readonly EngineCard[],
  seed?: string,
): EngineCard[];
export const BOT_NAMES: readonly string[];
export function chooseTableSeatCount(
  humanCount: number,
  tableMode: string,
  profileHint?: string,
): number;
export const GAME_PROFILES: Record<string, Record<string, unknown>>;
export const PROFILE_DEFAULTS: Record<string, unknown>;
export function getProfile(profileId: string): Record<string, unknown>;
