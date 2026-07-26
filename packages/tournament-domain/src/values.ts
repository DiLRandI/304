export interface TeamName {
  display: string;
  comparisonKey: string;
}

export function normalizeTeamName(input: string): TeamName {
  const display = input.normalize("NFC").trim().replace(/\s+/gu, " ");
  const length = Array.from(display).length;
  if (length < 2 || length > 32) {
    throw new Error("Team name must contain 2-32 characters");
  }
  return {
    display,
    comparisonKey: display.toLocaleLowerCase("und"),
  };
}
