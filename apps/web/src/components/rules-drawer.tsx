"use client";

import { useState } from "react";

const CARD_VALUES = [
  "Jack · 30 points",
  "Ace · 11 points",
  "Ten · 10 points",
  "King · 3 points",
  "Queen · 2 points",
  "Nine, Eight, Seven, and Six · 0 points",
] as const;

export function CardValues() {
  return (
    <ul className="card-values">
      {CARD_VALUES.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

export function RulesDrawer({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rules-drawer">
      <button
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Rules and card values
      </button>
      {open ? (
        <div
          aria-label="Rules and card values"
          aria-modal="false"
          className="rules-popover"
          role="dialog"
        >
          <div>
            <p className="eyebrow">At the table</p>
            <h2>Play only the actions your table offers.</h2>
          </div>
          <p>
            Bidding, trump choices, and cards are validated by the server. A
            suit must be followed when the table offers it as a legal card.
          </p>
          <section>
            <h3>Card values</h3>
            <CardValues />
          </section>
          <section>
            <h3>How bidding works</h3>
            <p>
              Your bid is the card-point total your team promises to win. Use
              the legal bid buttons or pass; the table tracks the current
              highest bid.
            </p>
          </section>
          <section>
            <h3>Trump and cutting</h3>
            <p>
              The trump maker chooses a suit when prompted. Follow the lead suit
              whenever you can; if you cannot, the table offers only the legal
              cut or discard choices.
            </p>
          </section>
          <section>
            <h3>Scoring tokens</h3>
            <p>
              After every hand, the server compares the bidder&apos;s points
              with the bid and updates the two team token totals.
            </p>
          </section>
          {profileId === "six_304_36" ? (
            <section>
              <h3>Six-seat 304-36</h3>
              <p>
                This labelled variant uses six alternating seats and the 36-card
                profile. The table still highlights only legal actions for your
                seat.
              </p>
            </section>
          ) : null}
          <button onClick={() => setOpen(false)} type="button">
            Close rules
          </button>
        </div>
      ) : null}
    </section>
  );
}
