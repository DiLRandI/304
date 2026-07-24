import { expect, test } from "@playwright/test";
import type { RoomProjection } from "@three-zero-four/contracts";
import {
  activeProjection,
  jackOfSpades,
  resultProjection,
  sevenOfClubs,
} from "../test/browser-fixtures.js";

function withPublicState(
  projection: RoomProjection,
  publicState: Record<string, unknown>,
): RoomProjection {
  projection.view = {
    ...projection.view,
    publicState: {
      ...(projection.view.publicState as Record<string, unknown>),
      ...publicState,
    },
  };
  return projection;
}

test("room setup defaults early settlement on", async ({ page }) => {
  await page.goto("/play");
  await expect(
    page.getByLabel("End hand when outcome is certain"),
  ).toBeChecked();
});

test("deterministic UI projections cover bid warnings, settlement, and reveal guidance", async ({
  page,
}) => {
  let projection = activeProjection(11);
  projection.view.legalActions = [
    { amount: 250, type: "BID" },
    { type: "PASS_BID" },
  ];

  await page.route("**/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/v1/rooms/")) {
      await route.continue();
      return;
    }
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      body: JSON.stringify(projection),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/room/guidance");
  await expect(page.locator('[aria-label="304 game table"]')).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Bid 250 — trump opens after trick one",
    }),
  ).toBeVisible();

  projection = withPublicState(activeProjection(12), {
    bidding: { currentBid: 250, currentBidSeat: 0 },
  });
  projection.view.legalActions = [
    { type: "TRUMP_CLOSE" },
    { type: "TRUMP_OPEN" },
  ];
  await page.reload();
  await expect(
    page.getByText(/Your 250 bid will open trump automatically/),
  ).toBeVisible();

  projection = withPublicState(activeProjection(13), {
    bidding: { currentBid: 200, currentBidSeat: 0 },
    trick: { plays: [], trumpRevealReason: null },
    trump: {
      indicator: null,
      indicatorVisible: false,
      isOpen: false,
      maker: 0,
      suit: null,
    },
  });
  projection.view.legalActions = [{ type: "TRUMP_CLOSE" }];
  await page.reload();
  await expect(page.getByText("Trump hidden.")).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Keep trump closed" }),
  ).toBeVisible();

  projection = withPublicState(activeProjection(14), {
    trick: {
      plays: [
        {
          card: { cardId: "Card Back", hidden: true },
          faceDown: true,
          seatIndex: 1,
        },
      ],
      trumpRevealReason: "high-bid-after-first-trick",
    },
    trump: {
      indicator: jackOfSpades,
      indicatorVisible: true,
      isOpen: true,
      maker: 0,
      suit: "spades",
    },
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Trump opened after trick one because the bid was 250 or more.",
  );
  await expect(
    page.getByText("Indicator: Jack of Spades, 30 points"),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Hidden card, played by Seat 2" }),
  ).toBeVisible();

  projection = withPublicState(activeProjection(15), {
    trick: {
      plays: [
        { card: sevenOfClubs, faceDown: false, seatIndex: 1 },
        {
          card: { cardId: "C_9", points: 20, rank: "9", suit: "clubs" },
          faceDown: true,
          seatIndex: 2,
        },
        {
          card: { cardId: "Card Back", hidden: true },
          faceDown: true,
          seatIndex: 0,
        },
      ],
      trumpRevealReason: "face-down-trump-cut",
    },
    trump: {
      indicator: jackOfSpades,
      indicatorVisible: true,
      isOpen: true,
      maker: 0,
      suit: "spades",
    },
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Trump opened because a face-down trump cut the trick.",
  );
  await expect(
    page.getByRole("img", {
      name: "Nine of Clubs, 20 points, played by Seat 3",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Hidden card, played by Seat 1" }),
  ).toBeVisible();

  projection = resultProjection();
  projection.eventVersion = 16;
  const publicState = projection.view.publicState as Record<string, unknown>;
  publicState.handResult = {
    ...(publicState.handResult as Record<string, unknown>),
    bidderTeamPoints: 160,
    otherTeamPoints: 42,
    settlementReason: "bid-reached",
    trickCount: 5,
  };
  await page.reload();
  await expect(
    page.getByText("Bidder points captured when play stopped"),
  ).toBeVisible();
  await expect(
    page.getByText(/points captured when play stopped/).first(),
  ).toBeVisible();
});
