"use client";

import type { GameAction, RoomProjection } from "@three-zero-four/contracts";
import { RulesDrawer } from "../../../components/rules-drawer";
import {
  type GameRoomView,
  type ProjectedCard,
  type ProjectedHandResult,
  readActiveRoomView,
} from "../model/room-view";
import { CardButton, CardFace, cardLabel } from "./card";

function isNoScoreResult(
  result: ProjectedHandResult,
): result is Extract<ProjectedHandResult, { noScore: true }> {
  return "noScore" in result && result.noScore === true;
}

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
        !isNoScoreResult(handResult) &&
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

function teamTrickPoints(
  seats: GameRoomView["publicState"]["seats"],
  team: "A" | "B",
): number {
  return seats
    .filter((seat) => seat.team === team)
    .reduce((total, seat) => total + seat.trickPoints, 0);
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
          <section aria-label="Current trick" className="trick-area">
            <p className="eyebrow">Current trick</p>
            <div
              className="trick-cards"
              data-seat-count={publicState.seatCount}
            >
              {view.publicState.trick.length === 0 ? (
                <p>Waiting for the lead card.</p>
              ) : (
                view.publicState.trick.map((play) => (
                  <div
                    aria-label={`${cardLabel(play.card)}, played by Seat ${play.seatIndex + 1}`}
                    className="trick-card"
                    data-hidden={play.card.hidden || undefined}
                    data-seat-index={play.seatIndex}
                    data-suit={play.card.suit ?? undefined}
                    key={`${play.seatIndex}-${play.card.cardId}`}
                    role="img"
                  >
                    <CardFace card={play.card} />
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
              <dd>
                {publicState.bid || "—"}
                {publicState.bid > 0 && bidderOwner ? (
                  <span className="metric-detail">{bidderOwner}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Trump</dt>
              <dd>{trumpLabel}</dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>
                A {publicState.tokens[0]} · B {publicState.tokens[1]}
              </dd>
            </div>
            <div>
              <dt>Trick points</dt>
              <dd>
                {publicState.trickPointsPartial
                  ? "Hidden until face-down cards are revealed"
                  : `A ${teamTrickPoints(publicState.seats, "A")} · B ${teamTrickPoints(publicState.seats, "B")}`}
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

      {publicState.handResult ? (
        <section
          aria-label="Hand result"
          aria-live="polite"
          className="hand-result"
        >
          <p className="eyebrow">
            Hand {publicState.handResult.handNumber} result
          </p>
          {isNoScoreResult(publicState.handResult) ? (
            <>
              <h2>No score movement</h2>
              <p>{publicState.handResult.reason}</p>
              <p>
                Tokens A {publicState.handResult.tokens[0]} · B{" "}
                {publicState.handResult.tokens[1]}
              </p>
            </>
          ) : (
            <>
              <h2>Team {publicState.handResult.winningTeam} wins the hand</h2>
              <div className="hand-result-summary">
                <p>
                  {bidderSeat &&
                  bidderSeat.team === publicState.handResult.bidderTeam
                    ? bidderOwner
                    : `Team ${publicState.handResult.bidderTeam}`}{" "}
                  bid {publicState.handResult.bid}
                </p>
                <p>
                  Team {publicState.handResult.bidderTeam}{" "}
                  {publicState.handResult.success
                    ? `met the ${publicState.handResult.bid} bid by ${publicState.handResult.bidderTeamPoints - publicState.handResult.bid}`
                    : `scored ${publicState.handResult.bidderTeamPoints} and missed by ${publicState.handResult.bid - publicState.handResult.bidderTeamPoints}`}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Bid</dt>
                  <dd>{publicState.handResult.bid}</dd>
                </div>
                <div>
                  <dt>Bidder points</dt>
                  <dd>{publicState.handResult.bidderTeamPoints}</dd>
                </div>
                <div>
                  <dt>Bid outcome</dt>
                  <dd>
                    {publicState.handResult.success ? "Bid met" : "Bid missed"}
                  </dd>
                </div>
                <div>
                  <dt>Trump</dt>
                  <dd>{trumpLabel}</dd>
                </div>
                <div>
                  <dt>Other team points</dt>
                  <dd>{publicState.handResult.otherTeamPoints}</dd>
                </div>
                <div>
                  <dt>Token movement</dt>
                  <dd>{publicState.handResult.movement}</dd>
                </div>
                <div>
                  <dt>Team tokens</dt>
                  <dd>
                    A {publicState.handResult.tokens[0]} · B{" "}
                    {publicState.handResult.tokens[1]}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </section>
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
