import { GameActionSchema } from "@three-zero-four/contracts";
import {
  acknowledgeGameplayResult,
  applyGameplayCommand,
  buildDeck,
  type Card,
  type GameplayCommand,
  type GameplayHand,
} from "@three-zero-four/gameplay";
import type { GameplayRecoveryEvent } from "../../application/gameplay-recovery.js";
import { RecoveryError } from "../../application/gameplay-recovery-error.js";
import { toGameplayCommand } from "./wire-gameplay-command-mapper.js";

const NON_GAMEPLAY_EVENTS = new Set([
  "AUTOPILOT_CANCELLED",
  "AUTOPILOT_ENABLED",
  "PLAYER_DISCONNECTED",
  "PLAYER_JOINED",
  "PLAYER_LEFT",
  "PLAYER_RECONNECTED",
  "ROOM_CLOSED",
  "ROOM_CREATED",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function replayDeck(
  roomId: string,
  hand: GameplayHand,
  value: unknown,
): Card[] {
  const nextHand = record(value);
  const audit = record(nextHand?.audit);
  const deck = nextHand?.deck;
  if (
    audit?.algorithm !== "hmac-sha256-v1" ||
    typeof audit.commitment !== "string" ||
    audit.commitment.length === 0 ||
    typeof audit.seed !== "string" ||
    audit.seed.length === 0 ||
    !Array.isArray(deck)
  ) {
    throw new RecoveryError(roomId);
  }
  const canonical = buildDeck(hand.profile);
  if (deck.length !== canonical.length) throw new RecoveryError(roomId);
  const cardsById = new Map<string, Card>(
    canonical.map((card) => [card.id, card]),
  );
  const seen = new Set<string>();
  return deck.map((value) => {
    const candidate = record(value);
    const id = candidate?.id;
    const card = typeof id === "string" ? cardsById.get(id) : undefined;
    if (!card || seen.has(card.id)) throw new RecoveryError(roomId);
    if (
      candidate?.points !== card.points ||
      candidate.rank !== card.rank ||
      candidate.suit !== card.suit
    ) {
      throw new RecoveryError(roomId);
    }
    seen.add(card.id);
    return card;
  });
}

function commandForEvent(
  roomId: string,
  hand: GameplayHand,
  event: GameplayRecoveryEvent,
  actorSeatIndex: number | null,
): GameplayCommand | null {
  if (event.eventType === "TRICK_ADVANCED") {
    return { actor: null, type: "ADVANCE_TRICK" };
  }
  if (NON_GAMEPLAY_EVENTS.has(event.eventType)) return null;
  const payload = record(event.payload);
  if (
    event.eventType !== "GAME_ACTION" &&
    event.eventType !== "BOT_ACTION" &&
    event.eventType !== "AUTOPILOT_ACTION"
  ) {
    throw new RecoveryError(roomId);
  }
  const parsed = GameActionSchema.safeParse(payload?.action);
  const actor =
    event.eventType === "GAME_ACTION" ? actorSeatIndex : payload?.seatIndex;
  if (
    !parsed.success ||
    typeof actor !== "number" ||
    !Number.isInteger(actor)
  ) {
    throw new RecoveryError(roomId);
  }
  return toGameplayCommand(
    parsed.data,
    actor,
    hand.profile.seatCount,
    hand.trump.indicator?.id ?? null,
  );
}

export function replayDomainGameplayEvent(
  roomId: string,
  hand: GameplayHand,
  event: GameplayRecoveryEvent,
  actorSeatIndex: number | null,
): GameplayHand {
  try {
    const command = commandForEvent(roomId, hand, event, actorSeatIndex);
    if (command === null) return hand;
    const decision =
      command.type === "ACK_RESULT"
        ? acknowledgeGameplayResult(
            hand,
            replayDeck(roomId, hand, record(event.payload)?.nextHand),
          )
        : applyGameplayCommand(hand, command);
    if (!decision.ok) throw new RecoveryError(roomId);
    return decision.hand;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError(roomId);
  }
}
