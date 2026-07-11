import { CardValues } from "../../components/rules-drawer";

export const dynamic = "force-dynamic";

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
          Two teams alternate seats. Bid from the options offered by the table,
          choose or reveal trump when prompted, and follow the lead suit when a
          legal card requires it.
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
