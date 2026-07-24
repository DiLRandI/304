export type TableConnection =
  | "connecting"
  | "live"
  | "offline"
  | "reconnecting";

export function TablePrompt({
  connection,
  isPlayersTurn,
  prompt,
  trickCardCount,
  trump,
  trumpRevealReason,
}: {
  connection: TableConnection;
  isPlayersTurn: boolean;
  prompt: string;
  trickCardCount: number;
  trump: { isOpen: boolean; suit: string | null };
  trumpRevealReason:
    | "face-down-trump-cut"
    | "high-bid-after-first-trick"
    | null;
}) {
  const trumpAnnouncement = trump.suit
    ? `Trump ${trump.isOpen ? "open" : "set"} to ${trump.suit}.`
    : "Trump hidden.";
  const trickAnnouncement = `${trickCardCount} ${
    trickCardCount === 1 ? "card" : "cards"
  } in current trick.`;
  const revealAnnouncement =
    trumpRevealReason === "face-down-trump-cut"
      ? "Trump opened because a face-down trump cut the trick."
      : trumpRevealReason === "high-bid-after-first-trick"
        ? "Trump opened after trick one because the bid was 250 or more."
        : "";
  const statusAnnouncement = [
    connection === "live" ? "Live table." : `${connection} connection.`,
    isPlayersTurn ? "Your turn." : "Waiting for the table.",
    trumpAnnouncement,
    revealAnnouncement,
    trickAnnouncement,
    prompt,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <section aria-live="polite" className="turn-prompt">
        <p className="eyebrow">
          {isPlayersTurn ? "Your turn" : "Table update"}
        </p>
        <p>{prompt}</p>
      </section>
      <p className="sr-only" role="status">
        {statusAnnouncement}
      </p>
    </>
  );
}
