export function seatDisplayName({
  displayName,
  occupantType,
  seatIndex,
}: {
  displayName: string | null;
  occupantType: "bot" | "empty" | "human";
  seatIndex: number;
}): string {
  const projectedName = displayName?.trim();
  if (projectedName) return projectedName;
  if (occupantType === "bot") return `Bot ${seatIndex + 1}`;
  return "Open seat";
}
