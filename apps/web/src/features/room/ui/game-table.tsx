"use client";

import type { GameAction, RoomProjection } from "@three-zero-four/contracts";
import { RulesDrawer } from "../../../components/rules-drawer";
import { partitionCardActions } from "../model/card-action";
import { readActiveRoomView } from "../model/room-view";
import { CommandActions } from "./command-actions";
import { CurrentTrick } from "./current-trick";
import { HandResult } from "./hand-result";
import { PlayerHand } from "./player-hand";
import { TableMetrics } from "./table-metrics";
import { TableSeats } from "./table-seats";

export type TableConnection =
  | "connecting"
  | "live"
  | "offline"
  | "reconnecting";

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
  const { commandActions } = partitionCardActions(
    view.privateSeat.hand,
    view.legalActions,
  );
  const isPlayersTurn = publicState.activeSeat === view.privateSeat.index;
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
        <TableSeats
          activeSeat={publicState.activeSeat}
          seats={publicState.seats}
        />

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

      <CommandActions
        actions={commandActions}
        hand={view.privateSeat.hand}
        handResult={publicState.handResult}
        onSelect={submit}
      />

      <PlayerHand
        hand={view.privateSeat.hand}
        isPlayersTurn={isPlayersTurn}
        legalActions={view.legalActions}
        onSelect={submit}
      />
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
