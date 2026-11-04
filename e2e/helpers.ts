import { expect, type Page } from "@playwright/test";

/** Connexion de démonstration (dev / test uniquement) en cliquant sur le compte. */
export async function login(page: Page, name: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function expectSaved(page: Page) {
  await expect(page.getByText(/Brouillon enregistré à/)).toBeVisible({ timeout: 10_000 });
}
