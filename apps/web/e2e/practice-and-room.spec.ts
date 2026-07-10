import { expect, type Page, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/room\//);
  await expect(page.locator('[aria-label="304 game table"]')).toBeVisible();
}

test("a guest starts Classic practice and submits its first legal action", async ({
  page,
}) => {
  await openPractice(page, uniqueName("Practice guest"));

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
});

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
