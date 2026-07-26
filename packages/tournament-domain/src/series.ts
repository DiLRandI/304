export type SeriesFormat = "bo1" | "bo3";
export type TournamentSide = "A" | "B";
export type ForfeitSide = TournamentSide | "both";

export interface SeriesState {
  format: SeriesFormat;
  requiredWins: 1 | 2;
  winsA: number;
  winsB: number;
  complete: boolean;
  winner?: TournamentSide;
  forfeit?: ForfeitSide;
}

export function createSeries(format: SeriesFormat): SeriesState {
  return {
    format,
    requiredWins: format === "bo1" ? 1 : 2,
    winsA: 0,
    winsB: 0,
    complete: false,
  };
}

export function recordSeriesWin(
  series: SeriesState,
  side: TournamentSide,
): SeriesState {
  if (series.complete) {
    throw new Error("Series is already complete");
  }
  const next: SeriesState = {
    ...series,
    winsA: series.winsA + (side === "A" ? 1 : 0),
    winsB: series.winsB + (side === "B" ? 1 : 0),
  };
  const winner =
    next.winsA === next.requiredWins
      ? "A"
      : next.winsB === next.requiredWins
        ? "B"
        : undefined;
  return winner === undefined ? next : { ...next, complete: true, winner };
}

export function applyForfeit(
  series: SeriesState,
  side: ForfeitSide,
): SeriesState {
  if (series.complete) {
    throw new Error("Series is already complete");
  }
  if (side === "both") {
    return { ...series, complete: true, forfeit: "both" };
  }
  const winner = side === "A" ? "B" : "A";
  return {
    ...series,
    winsA: winner === "A" ? series.requiredWins : 0,
    winsB: winner === "B" ? series.requiredWins : 0,
    complete: true,
    winner,
    forfeit: side,
  };
}
