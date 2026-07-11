import Link from "next/link";

export const dynamic = "force-dynamic";

const gameServiceUrl = process.env.NEXT_PUBLIC_GAME_SERVICE_URL;

export default function HomePage() {
  const serviceState = gameServiceUrl
    ? "Ready for private tables"
    : "Setup required";

  return (
    <main aria-labelledby="page-title" className="landing-page">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="brand">304 Online</p>
          <h1 id="page-title">A private table. Every card accounted for.</h1>
          <p className="summary">
            Play Sri Lankan 304 with bots or people you invite. The server owns
            the shuffle, legal moves, scoring, and recovery—your cards stay at
            your seat.
          </p>
          <div className="hero-actions">
            <Link className="primary-action" href="/play">
              Play 304
            </Link>
            <Link className="secondary-action" href="/rules">
              Learn the rules
            </Link>
          </div>
          <p className="landing-no-wagering">
            Casual play only. No money, prizes, or wagering.
          </p>
        </div>
        <aside aria-label="How private tables work" className="hero-table-card">
          <p className="eyebrow">How it works</p>
          <ol>
            <li>Choose practice or create a private room.</li>
            <li>Share an invite code only with your table.</li>
            <li>Play a server-validated hand from any screen size.</li>
          </ol>
        </aside>
      </section>

      <section className="readiness" aria-labelledby="readiness-title">
        <h2 id="readiness-title">Built for the table</h2>
        <dl className="readiness-list">
          <div>
            <dt>Game service</dt>
            <dd data-state={gameServiceUrl ? "ready" : "missing"}>
              {serviceState}
            </dd>
          </div>
          <div>
            <dt>Tables</dt>
            <dd>Classic four-seat and six-seat 304-36</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>Server-validated turns with durable recovery</dd>
          </div>
        </dl>
      </section>

      <nav aria-label="Public information" className="landing-policy-links">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </main>
  );
}
