import { expect, type Page, test } from "@playwright/test";
import type { RoomProjection } from "@three-zero-four/contracts";

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

async function dismissConsent(page: Page): Promise<void> {
  const essentialOnly = page.getByRole("button", { name: "Essential only" });
  if (await essentialOnly.isVisible()) await essentialOnly.click();
}

async function openPractice(page: Page, displayName: string): Promise<void> {
  await page.goto("/play");
  await dismissConsent(page);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Rule profile").selectOption("classic_304_4p");
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect(page.locator('[aria-label="304 game table"]')).toBeVisible();
}

async function openPracticeWithProfile(
  page: Page,
  displayName: string,
  profile: "classic_304_4p" | "six_304_36",
): Promise<void> {
  await page.goto("/play");
  await dismissConsent(page);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Rule profile").selectOption(profile);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect(page.locator('[aria-label="304 game table"]')).toBeVisible();
}

function isCommandResponse(responseUrl: string, method: string): boolean {
  return (
    method === "POST" &&
    /\/v1\/rooms\/[^/]+\/commands$/.test(new URL(responseUrl).pathname)
  );
}

async function nextVisibleAction(page: Page) {
  const controls = page.locator(
    '[aria-label="Legal actions"] button:not([disabled]), [aria-label="Your hand"] button:not([disabled])',
  );
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const label = (await control.textContent())?.trim();
    if (label === "Next hand" || label === "Play another match") continue;
    return control;
  }
  return null;
}

async function submitVisibleAction(page: Page): Promise<RoomProjection | null> {
  const action = await nextVisibleAction(page);
  if (!action) return null;
  const commandResponse = page.waitForResponse(
    (response) =>
      isCommandResponse(response.url(), response.request().method()),
    { timeout: 15_000 },
  );
  await action.click();
  const response = await commandResponse;
  expect(response.status()).toBe(200);
  return (await response.json()) as RoomProjection;
}

async function playVisibleActionsToResult(page: Page): Promise<void> {
  const result = page.getByRole("region", { name: "Hand result" });
  const deadline = Date.now() + 110_000;
  let submittedActions = 0;
  while (Date.now() < deadline && submittedActions < 160) {
    if (await result.isVisible()) return;
    if (await submitVisibleAction(page)) {
      submittedActions += 1;
    } else {
      await page.waitForTimeout(200);
    }
  }
  const prompt = await page
    .locator(".turn-prompt")
    .innerText()
    .catch(() => "");
  throw new Error(
    `Timed out before a visible hand result after ${submittedActions} submitted actions. Current prompt: ${prompt}`,
  );
}

async function playVisibleActionsUntil(
  pages: readonly Page[],
  complete: (projection: RoomProjection | null) => Promise<boolean>,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 110_000;
  let submittedActions = 0;
  while (Date.now() < deadline && submittedActions < 80) {
    if (await complete(null)) return;
    let submitted = false;
    for (const page of pages) {
      const projection = await submitVisibleAction(page);
      if (projection) {
        submitted = true;
        submittedActions += 1;
        if (await complete(projection)) return;
        break;
      }
    }
    if (!submitted) await pages[0]?.waitForTimeout(200);
  }
  throw new Error(
    `Timed out while waiting for ${description} after ${submittedActions} submitted actions.`,
  );
}

function hasCompleteSixSeatDeal(projection: RoomProjection | null): boolean {
  const publicState = (
    projection?.view as
      | {
          publicState?: {
            seats?: Array<{ index?: number; handSize?: number }>;
            trump?: { isOpen?: boolean; maker?: number | null };
          };
        }
      | undefined
  )?.publicState;
  const seats = publicState?.seats;
  if (seats?.length !== 6) return false;
  if (seats.every((seat) => seat.handSize === 6)) return true;

  const maker = publicState.trump?.maker;
  return (
    publicState.trump?.isOpen === false &&
    typeof maker === "number" &&
    seats.every((seat) => seat.handSize === (seat.index === maker ? 5 : 6))
  );
}

test("a guest starts Classic practice and submits its first legal action", async ({
  page,
}) => {
  await openPractice(page, uniqueName("Practice guest"));

  await page.getByRole("button", { name: "Rules and card values" }).click();
  await expect(
    page.getByRole("heading", { name: "How bidding works" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trump and cutting" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close rules" }).click();

  const action = page.locator('[aria-label="Legal actions"] button').first();
  await expect(action).toBeVisible();
  const commandResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/v1\/rooms\/[^/]+\/commands$/.test(new URL(response.url()).pathname),
  );

  await action.click();
  expect((await commandResponse).status()).toBe(200);
  await expect(page.locator('[aria-label="304 game table"]')).toBeVisible();
  await expect(
    page.getByText("You can leave after this hand finishes."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave table" })).toHaveCount(
    0,
  );
});

test("a guest retries a transient initial room-load failure without reloading", async ({
  page,
}) => {
  await page.goto("/play");
  await dismissConsent(page);
  await page.getByLabel("Display name").fill(uniqueName("Retry guest"));
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect(
    page.getByRole("heading", {
      name: "Set the table before the first hand.",
    }),
  ).toBeVisible();

  let allowRecovery = false;
  let interceptedInitialLoad = false;
  await page.route("**/v1/rooms/*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      !allowRecovery &&
      request.method() === "GET" &&
      /^\/v1\/rooms\/[^/]+$/.test(pathname)
    ) {
      interceptedInitialLoad = true;
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: "ROOM_BUSY",
            message: "Room temporarily unavailable",
          },
        }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    await route.continue();
  });

  await page.reload();
  await expect(page.getByText("Room temporarily unavailable")).toBeVisible();
  allowRecovery = true;
  const retryRequest = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      /^\/v1\/rooms\/[^/]+$/.test(new URL(request.url()).pathname),
    { timeout: 5_000 },
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await retryRequest;

  await expect(
    page.getByRole("heading", {
      name: "Set the table before the first hand.",
    }),
  ).toBeVisible();
  expect(interceptedInitialLoad).toBe(true);
  await page.getByRole("button", { name: "Leave table" }).click();
  await expect(page).toHaveURL(/\/play$/);
});

test("a private-room guest gets manual-copy guidance without the Clipboard API", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/play");
  await dismissConsent(page);
  await page.getByLabel("Display name").fill(uniqueName("Clipboard guest"));
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect
    .poll(() => page.evaluate(() => typeof navigator.clipboard))
    .toBe("undefined");

  await page.getByRole("button", { name: "Copy invite code" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Copy the invite code manually.",
  );
  await page.getByRole("button", { name: "Leave table" }).click();
  await expect(page).toHaveURL(/\/play$/);
});

for (const [profile, label] of [
  ["classic_304_4p", "Classic"] as const,
  ["six_304_36", "six-seat"] as const,
]) {
  test(`a guest completes a ${label} practice hand through visible controls`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openPracticeWithProfile(
      page,
      uniqueName(`${label} full hand`),
      profile,
    );

    await playVisibleActionsToResult(page);
    const result = page.getByRole("region", { name: "Hand result" });
    await expect(result).toBeVisible();
    await expect(result).toContainText(/Winning team [AB]|No score movement/);
    await expect(page.getByRole("button", { name: "Next hand" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Leave table" }),
    ).toBeVisible();

    const nextHand = page.waitForResponse((response) =>
      isCommandResponse(response.url(), response.request().method()),
    );
    await page.getByRole("button", { name: "Next hand" }).click();
    expect((await nextHand).status()).toBe(200);
    await expect(result).toBeHidden();
    await expect(page.locator(".table-metrics dd").first()).toHaveText("2");
  });
}

test("two private-table guests keep separate hands and recover after a socket reconnect", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await guest.addInitScript(() => {
    const trackedWindow = window as typeof window & {
      __g304TestSockets?: WebSocket[];
    };
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    class TrackedWebSocket extends NativeWebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        sockets.push(this);
      }
    }
    trackedWindow.__g304TestSockets = sockets;
    window.WebSocket = TrackedWebSocket;
  });

  try {
    await host.goto("/play");
    await dismissConsent(host);
    await host.getByLabel("Display name").fill(uniqueName("Private host"));
    await host.getByRole("button", { name: "Create private room" }).click();
    await expect(host).toHaveURL(/\/room\//);
    await expect(
      host.getByRole("heading", {
        name: "Set the table before the first hand.",
      }),
    ).toBeVisible();
    const inviteCode = await host.locator(".invite-panel code").innerText();

    await guest.goto("/play");
    await dismissConsent(guest);
    await guest.getByLabel("Display name").fill(uniqueName("Private guest"));
    await guest.getByLabel("Invite code").fill(inviteCode);
    await guest.getByRole("button", { name: "Join private room" }).click();
    await expect(guest).toHaveURL(/\/room\//);
    await expect(
      guest.getByText("Waiting for the host to start the game."),
    ).toBeVisible();
    await expect(
      host.locator('.lobby-seats article[data-seat-type="human"]'),
    ).toHaveCount(2);

    const startResponse = host.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/v1\/rooms\/[^/]+\/start$/.test(new URL(response.url()).pathname),
    );
    await host.getByRole("button", { name: "Start game" }).click();
    expect((await startResponse).status()).toBe(200);

    await expect(host.locator('[aria-label="304 game table"]')).toBeVisible();
    await expect(guest.locator('[aria-label="304 game table"]')).toBeVisible();
    const hostHand = await host.locator('[aria-label="Your hand"]').innerText();
    const guestHand = await guest
      .locator('[aria-label="Your hand"]')
      .innerText();
    expect(hostHand).not.toEqual(guestHand);

    const socketCount = await guest.evaluate(
      () =>
        (window as typeof window & { __g304TestSockets?: WebSocket[] })
          .__g304TestSockets?.length ?? 0,
    );
    await guest.evaluate(() => {
      const sockets = (
        window as typeof window & { __g304TestSockets?: WebSocket[] }
      ).__g304TestSockets;
      const openSocket = sockets?.find(
        (socket) => socket.readyState === WebSocket.OPEN,
      );
      openSocket?.close(1000, "release-reconnect-check");
    });
    await expect
      .poll(() =>
        guest.evaluate(
          () =>
            (window as typeof window & { __g304TestSockets?: WebSocket[] })
              .__g304TestSockets?.length ?? 0,
        ),
      )
      .toBeGreaterThan(socketCount);
    await expect(guest.getByText("Live table", { exact: true })).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("five browser guests start a six-seat private room with one bot and six allocated cards per seat", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext()),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [host, ...guests] = pages;
  if (!host) throw new Error("Host page was not created");

  try {
    await host.goto("/play");
    await dismissConsent(host);
    await host.getByLabel("Display name").fill(uniqueName("Six-seat host"));
    await host.getByLabel("Rule profile").selectOption("six_304_36");
    await host.getByRole("button", { name: "Create private room" }).click();
    await expect(host).toHaveURL(/\/room\//);
    const inviteCode = await host.locator(".invite-panel code").innerText();

    for (const [index, guest] of guests.entries()) {
      await guest.goto("/play");
      await dismissConsent(guest);
      await guest
        .getByLabel("Display name")
        .fill(uniqueName(`Six-seat guest ${index + 1}`));
      await guest.getByLabel("Invite code").fill(inviteCode);
      await guest.getByRole("button", { name: "Join private room" }).click();
      await expect(guest).toHaveURL(/\/room\//);
    }
    await expect(
      host.locator('.lobby-seats article[data-seat-type="human"]'),
    ).toHaveCount(5);

    const started = host.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/v1\/rooms\/[^/]+\/start$/.test(new URL(response.url()).pathname),
    );
    await host.getByRole("button", { name: "Start game" }).click();
    expect((await started).status()).toBe(200);
    for (const page of pages) {
      await expect(page.locator('[aria-label="304 game table"]')).toBeVisible();
    }

    await playVisibleActionsUntil(
      pages,
      async (projection) => hasCompleteSixSeatDeal(projection),
      "a complete six-seat deal",
    );
    await expect(
      host.locator('.seat-panel[data-seat-type="human"]'),
    ).toHaveCount(5);
    await expect(host.locator('.seat-panel[data-seat-type="bot"]')).toHaveCount(
      1,
    );
    await expect
      .poll(async () => {
        const handSizes = await host
          .locator(".seat-panel")
          .evaluateAll((panels) =>
            panels.map((panel) => Number(panel.getAttribute("data-hand-size"))),
          );
        return handSizes.sort((left, right) => left - right).join(",");
      })
      .toMatch(/^(5,6,6,6,6,6|6,6,6,6,6,6)$/);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
