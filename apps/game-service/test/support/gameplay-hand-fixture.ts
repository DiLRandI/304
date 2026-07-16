import {
  buildDeck,
  type GameplayHand,
  getRuleProfile,
  initialTokens,
  type RuleProfileId,
  seatIndex,
  startGameplayHand,
} from "@three-zero-four/gameplay";

export function startedGameplayHand(
  profileId: RuleProfileId = "classic_304_4p",
  secondBiddingEnabled = true,
): GameplayHand {
  const profile = getRuleProfile(profileId);
  return startGameplayHand({
    dealer: seatIndex(profile.seatCount - 1, profile.seatCount),
    deck: buildDeck(profile),
    handNumber: 1,
    profile,
    secondBiddingEnabled,
    tokens: initialTokens(profile),
  });
}
