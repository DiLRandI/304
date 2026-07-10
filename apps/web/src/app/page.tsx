export const dynamic = "force-dynamic";

const gameServiceUrl = process.env.NEXT_PUBLIC_GAME_SERVICE_URL;

export default function HomePage() {
  const serviceState = gameServiceUrl ? "Configured" : "Not configured";

  return (
    <main aria-labelledby="page-title">
      <section className="hero">
        <p className="brand">304 Online</p>
        <h1 id="page-title">A fair, private table for every hand.</h1>
        <p className="summary">
          The production game service is being connected to the new web client.
          It will keep private cards, turn validation, and scoring on the
          server.
        </p>
      </section>

      <section className="readiness" aria-labelledby="readiness-title">
        <h2 id="readiness-title">Launch foundation</h2>
        <dl>
          <div>
            <dt>Game service</dt>
            <dd data-state={gameServiceUrl ? "ready" : "missing"}>
              {serviceState}
            </dd>
          </div>
          <div>
            <dt>Tables</dt>
            <dd>Classic four-seat and six-seat 304</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>Server-validated games with durable recovery</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
