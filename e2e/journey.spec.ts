import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { expectSaved, login } from "./helpers";

/**
 * Parcours complet : le freelance saisit et soumet son CRA, le manager le valide,
 * le PDF validé est téléchargeable et son code se vérifie publiquement.
 */
test("saisie → soumission → validation → PDF → vérification", async ({ page, request }) => {
  // 1. Saisie au clavier et autosave
  await login(page, "Camille Rey");
  await page.goto("/cra?mois=2026-10");
  const sixth = page.getByRole("gridcell", { name: /^6 octobre,/ });
  await sixth.click();
  await page.keyboard.press("a");
  await expectSaved(page);
  await page.reload();
  await expect(page.getByRole("gridcell", { name: /^6 octobre,/ })).toHaveAccessibleName(/absence/);

  // 2. Contrôle bloquant : samedi travaillé sans motif
  await page.getByRole("gridcell", { name: /^3 octobre,/ }).click();
  await page.keyboard.press("j");
  await expectSaved(page);
  await page.getByRole("button", { name: "Soumettre le CRA" }).click();
  const recap = page.getByRole("dialog", { name: "Soumettre le CRA" });
  await expect(recap.getByText(/motif de dérogation obligatoire/)).toBeVisible();
  await expect(recap.getByRole("button", { name: "Confirmer la soumission" })).toBeDisabled();
  await recap.getByRole("button", { name: "Annuler" }).click();
  await page.getByLabel(/Motif de dérogation/).fill("Mise en production");
  await expectSaved(page);

  // 3. Soumission
  await page.getByRole("button", { name: "Soumettre le CRA" }).click();
  await recap.getByRole("button", { name: "Confirmer la soumission" }).click();
  await expect(page.getByRole("button", { name: "En attente du manager" })).toBeVisible();
  const pdfHref = await page.getByRole("link", { name: /Voir le PDF/ }).getAttribute("href");
  expect(pdfHref).toMatch(/^\/api\/cra\/[^/]+\/pdf$/);

  // 4. Validation par le manager
  await login(page, "Mehdi Tazi");
  const id = pdfHref!.split("/")[3];
  await page.goto(`/validation?statut=SUBMITTED&cra=${id}`);
  await expect(page.getByRole("heading", { name: "Camille Rey" })).toBeVisible();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.ok()),
    page.getByRole("button", { name: "Valider le CRA" }).click(),
  ]);
  await page.goto(`/validation?statut=VALIDATED&cra=${id}`);
  await expect(page.getByText(/Validé par Mehdi Tazi/)).toBeVisible();

  // 5. PDF validé (une page) et vérification publique de son code
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const body = (await pdf.body()).toString("latin1");
  expect(body.startsWith("%PDF-")).toBe(true);
  expect(body.match(/\/Type \/Page\b/g)?.length).toBe(1);

  await login(page, "Camille Rey");
  const xlsx = await page.request.get(pdfHref!.replace("/pdf", "/xlsx"));
  expect(xlsx.status()).toBe(200);

  // Code d'authenticité lu dans l'onglet « Synthèse » de l'Excel (fichier compressé : lu avec ExcelJS)
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await xlsx.body()) as unknown as ArrayBuffer);
  const summary = book.getWorksheet("Synthèse")!;
  const header = (summary.getRow(1).values as unknown[]).indexOf("Code d'authenticité");
  const code = String(summary.getRow(2).getCell(header).value ?? "");
  expect(code).toMatch(/^CRA-\d{4}-[0-9A-Z]{1,8}-[0-9A-Z]{10}$/);
  const anonymous = await request.get(`/verify/${code}`);
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.text()).toContain("Document authentique");
});
