export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <main aria-labelledby="privacy-title" className="public-page">
      <p className="eyebrow">Privacy</p>
      <h1 id="privacy-title">Private tables need only the essentials.</h1>
      <section>
        <h2>What the game uses</h2>
        <p>
          Your display name, a session cookie, room membership, and game events
          are used to run and recover your private table. Card views are scoped
          to the seat the server authorizes.
        </p>
      </section>
      <section>
        <h2>What the game does not collect</h2>
        <p>No payment, location, or contact data is collected.</p>
      </section>
      <section>
        <h2>Optional analytics</h2>
        <p>
          Optional anonymous analytics are disabled unless you explicitly opt in
          and this release has a configured analytics endpoint. Analytics events
          use a small allowlist and never include cards, player IDs, session
          values, or invite codes.
        </p>
      </section>
    </main>
  );
}
