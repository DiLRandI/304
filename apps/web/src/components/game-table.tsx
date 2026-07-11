"use client";

import type { GameAction, RoomProjection } from "@three-zero-four/contracts";
import { type ProjectedCard, readActiveRoomView } from "../lib/room-view";
import { CardButton, cardLabel } from "./card";
import { RulesDrawer } from "./rules-drawer";

export type TableConnection =
  | "connecting"
  | "live"
  | "offline"
  | "reconnecting";

function actionLabel(action: GameAction): string {
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
      return "Continue";
    case "SELECT_TRUMP":
    case "PLAY_CARD":
      return "";
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
  projection,
  submit,
}: {
  connection: TableConnection;
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
  const commandActions = view.legalActions.filter(
    (action) => action.type !== "PLAY_CARD" && action.type !== "SELECT_TRUMP",
  );
  const isPlayersTurn = publicState.activeSeat === view.privateSeat.index;
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
            className="seat-panel"
            data-active={seat.index === publicState.activeSeat || undefined}
            data-me={seat.isMe || undefined}
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
          <section aria-label="Current trick" className="trick-area">
            <p className="eyebrow">Current trick</p>
            <div className="trick-cards">
              {view.publicState.trick.length === 0 ? (
                <p>Waiting for the lead card.</p>
              ) : (
                view.publicState.trick.map((play) => (
                  <div
                    className="trick-card"
                    key={`${play.seatIndex}-${play.card.cardId}`}
                  >
                    <span>
                      {play.card.hidden ? "Card back" : cardLabel(play.card)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <dl className="table-metrics">
            <div>
              <dt>Hand</dt>
              <dd>{publicState.handNumber}</dd>
            </div>
            <div>
              <dt>Bid</dt>
              <dd>{publicState.bid || "—"}</dd>
            </div>
            <div>
              <dt>Trump</dt>
              <dd>
                {publicState.trump.suit
                  ? `${suitSymbol(publicState.trump.suit)} ${publicState.trump.suit}`
                  : "Hidden"}
              </dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>
                A {publicState.tokens[0]} · B {publicState.tokens[1]}
              </dd>
            </div>
          </dl>
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

      {commandActions.length > 0 ? (
        <section aria-label="Legal actions" className="command-actions">
          {commandActions.map((action) => (
            <button
              key={JSON.stringify(action)}
              onClick={() => submit(action)}
              type="button"
            >
              {actionLabel(action)}
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
          />
        ))}
      </section>
      <RulesDrawer />
    </section>
  );
}
