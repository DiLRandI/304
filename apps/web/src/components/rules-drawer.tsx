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

export function RulesDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <section className="rules-drawer">
      <button onClick={() => setOpen((current) => !current)} type="button">
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
          <CardValues />
          <button onClick={() => setOpen(false)} type="button">
            Close rules
          </button>
        </div>
      ) : null}
    </section>
  );
}
