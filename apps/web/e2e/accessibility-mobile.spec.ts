import { devices, expect, type Page, test } from "@playwright/test";

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

async function dismissConsent(page: Page): Promise<void> {
  const essentialOnly = page.getByRole("button", { name: "Essential only" });
  if (await essentialOnly.isVisible()) await essentialOnly.click();
}

async function startPractice(
  page: Page,
  ruleProfileId: "classic_304_4p" | "six_304_36" = "classic_304_4p",
): Promise<void> {
  await page.goto("/play");
  await dismissConsent(page);
  await page.getByLabel("Display name").fill(uniqueName("Accessibility guest"));
  await page.getByLabel("Rule profile").selectOption(ruleProfileId);
  await page.getByRole("button", { name: "Start practice" }).click();
  await expect(page.locator('[aria-label="304 game table"]')).toBeVisible();
}

test("six-seat mobile play keeps the prompt, legal action, and private hand reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startPractice(page, "six_304_36");

  const prompt = page.locator(".turn-prompt");
  const action = page.locator('[aria-label="Legal actions"] button').first();
  const hand = page.locator('[aria-label="Your hand"]');

  for (const locator of [prompt, action, hand]) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    await expect(locator).toBeInViewport();
  }

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("display preferences stay tappable inside a touch-mobile viewport", async ({
  browser,
}) => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  try {
    await page.goto("/play");
    await dismissConsent(page);
    await page.locator("summary").click();

    const highContrast = page.getByLabel("High contrast");
    const reducedMotion = page.getByLabel("Reduce motion");
    for (const control of [highContrast, reducedMotion]) {
      await expect(control).toBeVisible();
      await expect(control).toBeInViewport();
    }

    await highContrast.check();
    await reducedMotion.check();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
    await expect(page.locator("html")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
  } finally {
    await context.close();
  }
});

test("keyboard action controls and display preferences work without pointer-only behavior", async ({
  page,
}) => {
  await startPractice(page);

  await page.locator("summary").click();
  await page.getByLabel("High contrast").check();
  await page.getByLabel("Reduce motion").check();
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );

  const action = page.locator('[aria-label="Legal actions"] button').first();
  await expect(action).toBeVisible();
  await action.focus();
  await expect(action).toBeFocused();
  const commandResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/v1\/rooms\/[^/]+\/commands$/.test(new URL(response.url()).pathname),
  );
  await page.keyboard.press("Enter");
  expect((await commandResponse).status()).toBe(200);
});
