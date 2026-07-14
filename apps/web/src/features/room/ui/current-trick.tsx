import type { GameRoomView } from "../model/room-view";
import { CardFace, cardLabel } from "./card";

export function CurrentTrick({
  seatCount,
  trick,
}: {
  seatCount: 4 | 6;
  trick: GameRoomView["publicState"]["trick"];
}) {
  return (
    <section aria-label="Current trick" className="trick-area">
      <p className="eyebrow">Current trick</p>
      <div className="trick-cards" data-seat-count={seatCount}>
        {trick.length === 0 ? (
          <p>Waiting for the lead card.</p>
        ) : (
          trick.map((play) => (
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
  );
}
