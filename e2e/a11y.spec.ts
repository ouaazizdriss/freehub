import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Audit automatique WCAG 2.1 A/AA (axe-core) des écrans principaux, par profil. */
const SCREENS: { who: string | null; paths: string[] }[] = [
  { who: null, paths: ["/login", "/verify"] },
  { who: "Camille Rey", paths: ["/cra", "/absences", "/missions"] },
  { who: "Mehdi Tazi", paths: ["/validation", "/pilotage", "/freelances", "/absences"] },
  { who: "Inès Lahlou", paths: ["/freelances?vue=missions", "/cra"] },
];

for (const { who, paths } of SCREENS) {
  for (const path of paths) {
    test(`a11y ${who ?? "public"} ${path}`, async ({ page }) => {
      if (who) await login(page, who);
      else await page.context().clearCookies();
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const summary = results.violations.map(
        (v) => `${v.id} (${v.impact}) : ${v.nodes.length} × ${v.nodes[0]?.target.join(" ")}`,
      );
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }
}
