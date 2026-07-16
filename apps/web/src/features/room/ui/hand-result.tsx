import type { ProjectedHandResult } from "../model/hand-result-view";

function isNoScoreResult(
  result: ProjectedHandResult,
): result is Extract<ProjectedHandResult, { noScore: true }> {
  return "noScore" in result && result.noScore === true;
}

export function HandResult({
  bidderOwner,
  bidderSeatTeam,
  result,
  trumpLabel,
}: {
  bidderOwner: string | null;
  bidderSeatTeam: "A" | "B" | null;
  result: ProjectedHandResult;
  trumpLabel: string;
}) {
  return (
    <section
      aria-label="Hand result"
      aria-live="polite"
      className="hand-result"
    >
      <p className="eyebrow">Hand {result.handNumber} result</p>
      {isNoScoreResult(result) ? (
        <>
          <h2>No score movement</h2>
          <p>{result.reason}</p>
          <p>
            Tokens A {result.tokens[0]} · B {result.tokens[1]}
          </p>
        </>
      ) : (
        <>
          <h2>Team {result.winningTeam} wins the hand</h2>
          <div className="hand-result-summary">
            <p>
              {bidderOwner && bidderSeatTeam === result.bidderTeam
                ? bidderOwner
                : `Team ${result.bidderTeam}`}{" "}
              bid {result.bid}
            </p>
            <p>
              Team {result.bidderTeam}{" "}
              {result.success
                ? `met the ${result.bid} bid by ${result.bidderTeamPoints - result.bid}`
                : `scored ${result.bidderTeamPoints} and missed by ${result.bid - result.bidderTeamPoints}`}
            </p>
          </div>
          <dl>
            <div>
              <dt>Bid</dt>
              <dd>{result.bid}</dd>
            </div>
            <div>
              <dt>Bidder points</dt>
              <dd>{result.bidderTeamPoints}</dd>
            </div>
            <div>
              <dt>Bid outcome</dt>
              <dd>{result.success ? "Bid met" : "Bid missed"}</dd>
            </div>
            <div>
              <dt>Trump</dt>
              <dd>{trumpLabel}</dd>
            </div>
            <div>
              <dt>Other team points</dt>
              <dd>{result.otherTeamPoints}</dd>
            </div>
            <div>
              <dt>Token movement</dt>
              <dd>{result.movement}</dd>
            </div>
            <div>
              <dt>Team tokens</dt>
              <dd>
                A {result.tokens[0]} · B {result.tokens[1]}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
