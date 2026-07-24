import type { GameRoomView } from "../model/room-view";

function teamTrickPoints(
  seats: GameRoomView["publicState"]["seats"],
  team: "A" | "B",
): number {
  return seats
    .filter((seat) => seat.team === team)
    .reduce((total, seat) => total + seat.trickPoints, 0);
}

export function TableMetrics({
  bidderOwner,
  publicState,
  trumpIndicatorLabel,
  trumpLabel,
}: {
  bidderOwner: string | null;
  publicState: GameRoomView["publicState"];
  trumpIndicatorLabel: string | null;
  trumpLabel: string;
}) {
  return (
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
        <dd>
          {trumpLabel}
          {trumpIndicatorLabel ? (
            <span className="metric-detail">
              Indicator: {trumpIndicatorLabel}
            </span>
          ) : null}
        </dd>
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
  );
}
