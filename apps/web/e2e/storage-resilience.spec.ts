import { expect, test } from "@playwright/test";

test("public routes remain usable when local storage access is denied", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    });
  });

  await page.goto("/play");
  await expect(
    page.getByRole("heading", { name: "Find your next hand." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Essential only" }).click();
  await expect(
    page.getByRole("complementary", { name: "Privacy choices" }),
  ).toHaveCount(0);
  await page.locator("summary").click();
  await expect(page.getByLabel("Card size")).toHaveValue("normal");
  await expect(page.getByLabel("High contrast")).not.toBeChecked();
  await page.getByLabel("High contrast").check();
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");

  await page.goto("/rules");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("consent and display preferences stay usable when storage writes fail", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.setItem = function blockedSetItem(): never {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    };
  });

  await page.goto("/play");
  await page.getByRole("button", { name: "Essential only" }).click();
  await expect(
    page.getByRole("complementary", { name: "Privacy choices" }),
  ).toHaveCount(0);

  await page.locator("summary").click();
  await page.getByLabel("Card size").selectOption("large");
  await page.getByLabel("High contrast").check();
  await page.getByLabel("Reduce motion").check();
  await expect(page.locator("html")).toHaveAttribute("data-card-size", "large");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  expect(pageErrors).toEqual([]);
});
