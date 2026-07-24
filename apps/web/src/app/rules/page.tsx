import { CardValues } from "../../features/rules/ui/card-values";

export default function RulesPage() {
  return (
    <main aria-labelledby="rules-title" className="public-page">
      <p className="eyebrow">How 304 Online plays</p>
      <h1 id="rules-title">Server-validated casual 304.</h1>
      <p className="summary">
        Your table shows only actions that are legal for your seat. The server
        shuffles, validates bidding and card play, records scores, and recovers
        a table after a connection interruption.
      </p>

      <section>
        <h2>Classic four-seat 304</h2>
        <p>
          Two teams alternate seats. The player to the dealer&apos;s right leads
          trick one. Bid from the options offered by the table, choose or reveal
          trump when prompted, and follow the lead suit when a legal card
          requires it.
        </p>
        <p>
          A bid of 250 or more opens the indicator and trump suit after trick
          one. Below 250, closed trump stays hidden until a face-down trump cut
          opens it. Unrelated face-down non-trumps stay concealed.
        </p>
      </section>

      <section>
        <h2>Six-seat 304-36</h2>
        <p>
          This is the labeled six-seat 304-36 variant. It uses the same
          server-controlled table flow and is not a custom rules editor.
        </p>
      </section>

      <section>
        <h2>Card values</h2>
        <CardValues />
      </section>
    </main>
  );
}
