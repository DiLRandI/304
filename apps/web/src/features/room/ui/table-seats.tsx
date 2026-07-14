import type { GameRoomView } from "../model/room-view";

export function TableSeats({
  activeSeat,
  seats,
}: {
  activeSeat: number | null;
  seats: GameRoomView["publicState"]["seats"];
}) {
  return seats.map((seat) => (
    <article
      aria-label={`Seat ${seat.index + 1}`}
      className="seat-panel"
      data-active={seat.index === activeSeat || undefined}
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
  ));
}
