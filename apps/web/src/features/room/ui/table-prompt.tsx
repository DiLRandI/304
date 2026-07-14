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
}: {
  connection: TableConnection;
  isPlayersTurn: boolean;
  prompt: string;
  trickCardCount: number;
  trump: { isOpen: boolean; suit: string | null };
}) {
  const trumpAnnouncement = trump.suit
    ? `Trump ${trump.isOpen ? "open" : "set"} to ${trump.suit}.`
    : "Trump hidden.";
  const trickAnnouncement = `${trickCardCount} ${
    trickCardCount === 1 ? "card" : "cards"
  } in current trick.`;

  return (
    <>
      <section aria-live="polite" className="turn-prompt">
        <p className="eyebrow">
          {isPlayersTurn ? "Your turn" : "Table update"}
        </p>
        <p>{prompt}</p>
      </section>
      <p className="sr-only" role="status">
        {connection === "live" ? "Live table." : `${connection} connection.`}{" "}
        {isPlayersTurn ? "Your turn." : "Waiting for the table."}{" "}
        {trumpAnnouncement} {trickAnnouncement} {prompt}
      </p>
    </>
  );
}
