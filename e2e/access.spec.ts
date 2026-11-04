import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("visiteur non connecté : redirection vers la connexion, API en 401", async ({ page, request }) => {
  await page.goto("/cra");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/api/signature", { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(300);
  expect((await request.post("/api/cron/reminders")).status()).toBe(401);
});

test("freelance : pas d'accès à la validation ni au référentiel", async ({ page }) => {
  await login(page, "Camille Rey");
  for (const path of ["/validation", "/freelances", "/pilotage"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/forbidden$/);
  }
});

test("finance : pilotage en lecture, pas de référentiel ni de décision", async ({ page }) => {
  await login(page, "Youssef Kettani");
  await page.goto("/pilotage");
  await expect(page.getByText("Budget consommé")).toBeVisible();
  await page.goto("/validation");
  await expect(page.getByText("Consultation seule pour votre profil.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Valider le CRA" })).toHaveCount(0);
  await page.goto("/freelances");
  await expect(page).toHaveURL(/\/forbidden$/);
});

test("manager : périmètre limité à ses missions", async ({ page }) => {
  await login(page, "Salma Berrada");
  await page.goto("/freelances");
  await expect(page.getByText("Sofia Amrani")).toBeVisible();
  await expect(page.getByText("Camille Rey")).toHaveCount(0);
  await page.goto("/validation?statut=ALL");
  await expect(page.getByText("Camille Rey")).toHaveCount(0);
});
