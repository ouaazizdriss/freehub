import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout (Lot 6).
 *   E2E_DATABASE_URL=postgresql://…/freelancehub_e2e  E2E_BASE_URL=http://localhost:3200  npm run test:e2e
 * - E2E_DATABASE_URL (obligatoire) : base DÉDIÉE (nom en _e2e ou _test), réinitialisée avant la suite ;
 * - E2E_BASE_URL : serveur déjà démarré SUR CETTE MÊME BASE ; sinon `next dev` est lancé. (Pas `next start` :
 *   la connexion de démo est désactivée en production, volontairement sans exception.)
 * Les tests modifient les données : exécution séquentielle (1 worker).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3300";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  // Pas de nouvelle tentative : la suite modifie les données (un second essai échouerait autrement).
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Large : en CI, `next dev` compile chaque route à la première visite.
  timeout: 180_000,
  use: {
    baseURL,
    locale: "fr-FR",
    timezoneId: "Africa/Casablanca",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    // Chrome installé sur le poste / l'agent CI (pas de téléchargement de navigateur).
    channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next dev -p 3300",
        // Page sans accès base : le serveur est prêt avant que globalSetup ne migre et ne remplisse la base.
        url: `${baseURL}/verify`,
        reuseExistingServer: false,
        env: { DATABASE_URL: process.env.E2E_DATABASE_URL ?? "", AUTH_DEV_LOGIN: "true" },
        timeout: 120_000,
      },
});
