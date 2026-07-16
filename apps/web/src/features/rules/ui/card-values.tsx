const CARD_VALUES = [
  "Jack · 30 points",
  "Nine · 20 points",
  "Ace · 11 points",
  "Ten · 10 points",
  "King · 3 points",
  "Queen · 2 points",
  "Eight, Seven, and Six · 0 points",
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
