"use client";

import type { GameAction, RoomProjection } from "@three-zero-four/contracts";
import { RulesDrawer } from "../../../components/rules-drawer";
import type { ProjectedCard } from "../model/card-view";
import type { ProjectedHandResult } from "../model/hand-result-view";
import { readActiveRoomView } from "../model/room-view";
import { CardButton, cardLabel } from "./card";
import { CurrentTrick } from "./current-trick";
import { HandResult } from "./hand-result";
import { TableMetrics } from "./table-metrics";

export type TableConnection =
  | "connecting"
  | "live"
  | "offline"
  | "reconnecting";

function actionLabel(
  action: GameAction,
  handResult: ProjectedHandResult | null,
  privateHand: readonly ProjectedCard[],
): string {
  switch (action.type) {
    case "BID":
      return `Bid ${action.amount}`;
    case "PASS_BID":
      return "Pass bid";
    case "TRUMP_OPEN":
      return "Open trump";
    case "TRUMP_CLOSE":
      return "Keep trump closed";
    case "ACK_RESULT":
      return handResult &&
        !("noScore" in handResult) &&
        handResult.matchComplete
        ? "Play another match"
        : "Next hand";
    case "SELECT_TRUMP": {
      const card = privateHand.find((item) => item.cardId === action.cardId);
      return card ? `Choose ${cardLabel(card)} as trump` : "Choose trump";
    }
    case "PLAY_CARD": {
      if (action.fromIndicator) {
        return "Play hidden trump indicator face down";
      }
      const card = privateHand.find((item) => item.cardId === action.cardId);
      if (!card) {
        return action.faceDown
          ? "Play a legal card face down"
          : "Play a legal card";
      }
      return action.faceDown
        ? `Play ${cardLabel(card)} face down`
        : `Play ${cardLabel(card)}`;
    }
  }
}

function cardAction(
  card: ProjectedCard,
  actions: readonly GameAction[],
): GameAction | null {
  const matching = actions.filter(
    (action) =>
      (action.type === "PLAY_CARD" || action.type === "SELECT_TRUMP") &&
      action.cardId === card.cardId,
  );
  return (
    matching.find(
      (action) => action.type !== "PLAY_CARD" || action.faceDown === false,
    ) ??
    matching[0] ??
    null
  );
}

function suitSymbol(suit: string | null): string {
  if (suit === "clubs") return "♣";
  if (suit === "diamonds") return "♦";
  if (suit === "hearts") return "♥";
  if (suit === "spades") return "♠";
  return "?";
}

export function GameTable({
  connection,
  leave,
  projection,
  submit,
}: {
  connection: TableConnection;
  leave(): void;
  projection: RoomProjection;
  submit(action: GameAction): void;
}) {
  const view = readActiveRoomView(projection);
  if (!view) {
    return (
      <section aria-live="polite" className="safe-table-state">
        This table update could not be displayed safely.
      </section>
    );
  }
  const publicState = view.publicState;
  const bidderSeat =
    publicState.bidderSeatIndex === null
      ? null
      : (publicState.seats.find(
          (seat) => seat.index === publicState.bidderSeatIndex,
        ) ?? null);
  const bidderOwner = bidderSeat
    ? `Team ${bidderSeat.team} · ${bidderSeat.displayName} (${bidderSeat.seatLabel})`
    : null;
  const primaryCardActions = new Set(
    view.privateSeat.hand
      .map((card) => cardAction(card, view.legalActions))
      .filter((action): action is GameAction => action !== null),
  );
  const commandActions = view.legalActions.filter(
    (action) => !primaryCardActions.has(action),
  );
  const isPlayersTurn = publicState.activeSeat === view.privateSeat.index;
  const cardLegalityNote = isPlayersTurn
    ? "This card is not legal for this turn. Use the highlighted legal cards or action buttons."
    : "Wait for your turn. The table will highlight legal cards when you can act.";
  const trumpLabel = publicState.trump.suit
    ? `${suitSymbol(publicState.trump.suit)} ${publicState.trump.suit}`
    : "Hidden";
  const trumpAnnouncement = publicState.trump.suit
    ? `Trump ${publicState.trump.isOpen ? "open" : "set"} to ${publicState.trump.suit}.`
    : "Trump hidden.";
  const trickAnnouncement = `${view.publicState.trick.length} ${
    view.publicState.trick.length === 1 ? "card" : "cards"
  } in current trick.`;

  return (
    <section
      aria-label="304 game table"
      className="game-table"
      data-seat-count={publicState.seatCount}
    >
      <header className="table-status">
        <p className="eyebrow">
          {publicState.profileId === "six_304_36"
            ? "Six-seat 304-36"
            : "Classic 304"}
        </p>
        <p
          aria-live="polite"
          className="connection-state"
          data-connection={connection}
        >
          {connection === "live" ? "Live table" : `${connection} connection`}
        </p>
      </header>

      <div className="table-board" data-seat-count={publicState.seatCount}>
        {publicState.seats.map((seat) => (
          <article
            aria-label={`Seat ${seat.index + 1}`}
            className="seat-panel"
            data-active={seat.index === publicState.activeSeat || undefined}
            data-hand-size={seat.handSize}
            data-me={seat.isMe || undefined}
            data-seat-type={seat.type}
            data-team={seat.team}
            key={seat.index}
          >
            <p className="seat-kicker">{seat.isMe ? "You" : seat.seatLabel}</p>
            <h2>{seat.displayName}</h2>
            <p>
              Team {seat.team} · {seat.handSize} cards
              {seat.autopilot ? " · Autopilot" : ""}
            </p>
          </article>
        ))}

        <div className="table-center">
          <CurrentTrick
            seatCount={publicState.seatCount}
            trick={publicState.trick}
          />

          <TableMetrics
            bidderOwner={bidderOwner}
            publicState={publicState}
            trumpLabel={trumpLabel}
          />
        </div>
      </div>

      <section aria-live="polite" className="turn-prompt">
        <p className="eyebrow">
          {isPlayersTurn ? "Your turn" : "Table update"}
        </p>
        <p>{view.prompt}</p>
      </section>
      <p className="sr-only" role="status">
        {connection === "live" ? "Live table." : `${connection} connection.`}{" "}
        {isPlayersTurn ? "Your turn." : "Waiting for the table."}{" "}
        {trumpAnnouncement} {trickAnnouncement} {view.prompt}
      </p>

      {publicState.handResult ? (
        <HandResult
          bidderOwner={bidderOwner}
          bidderSeatTeam={bidderSeat?.team ?? null}
          result={publicState.handResult}
          trumpLabel={trumpLabel}
        />
      ) : null}

      {commandActions.length > 0 ? (
        <section aria-label="Legal actions" className="command-actions">
          {commandActions.map((action) => (
            <button
              key={JSON.stringify(action)}
              onClick={() => submit(action)}
              type="button"
            >
              {actionLabel(
                action,
                publicState.handResult,
                view.privateSeat.hand,
              )}
            </button>
          ))}
        </section>
      ) : null}

      <section aria-label="Your hand" className="player-hand">
        {view.privateSeat.hand.map((card) => (
          <CardButton
            action={cardAction(card, view.legalActions)}
            card={card}
            key={card.cardId}
            onSelect={submit}
            unavailableReason={cardLegalityNote}
          />
        ))}
      </section>
      <p className="card-legality-note" id="card-legality-note">
        {cardLegalityNote}
      </p>
      <RulesDrawer profileId={publicState.profileId} />
      <div className="table-exit">
        {projection.status === "hand_result" ? (
          <button className="leave-table" onClick={leave} type="button">
            Leave table
          </button>
        ) : (
          <p className="table-exit-note">
            You can leave after this hand finishes.
          </p>
        )}
      </div>
    </section>
  );
}
