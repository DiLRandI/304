const supportContact = process.env.NEXT_PUBLIC_SUPPORT_CONTACT?.trim();

export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <main aria-labelledby="terms-title" className="public-page">
      <p className="eyebrow">Terms</p>
      <h1 id="terms-title">A casual card table, not a wagering service.</h1>
      <section>
        <h2>Entertainment only</h2>
        <p>No money, prizes, or wagering.</p>
        <p>
          Participate responsibly, follow local laws that apply to you, and do
          not use the service to organize gambling or financial transfers.
        </p>
      </section>
      <section>
        <h2>Your table</h2>
        <p>
          Keep private invite codes with people you intend to play with. Do not
          attempt to bypass server checks, disrupt another table, or share
          private game information without the participants' permission.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          {supportContact
            ? `Release contact: ${supportContact}`
            : "A release contact channel is not configured for this environment."}
        </p>
      </section>
    </main>
  );
}
