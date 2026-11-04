import "server-only";
import ExcelJS from "exceljs";
import { isWeekend, weekdayMon0 } from "@/lib/domain/calendar";
import type { TimesheetDocument } from "./content";

/**
 * Exports Excel (.xlsx réel, cellules typées, format monétaire, en-têtes figés).
 * - CRA unitaire : onglets « Détail jours » + « Synthèse » ;
 * - export mensuel (Admin / Finance) : tous les CRA soumis ou validés du mois.
 */

const STATUS_LABELS = { DRAFT: "Brouillon", SUBMITTED: "Soumis", VALIDATED: "Validé", REJECTED: "À corriger" } as const;
const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F6EF" } };
/** Format monétaire de la devise du contrat (EUR → €). */
const money = (currency: string) => `#,##0.00 "${currency === "EUR" ? "€" : currency.replace(/[^A-Z]/g, "")}"`;
// Pas de préfixe anti-formule : ExcelJS écrit les chaînes comme des cellules texte, jamais évaluées.

function natureOf(doc: TimesheetDocument, date: string): string {
  const d = doc.days.find((x) => x.date === date);
  if (d?.workHalfDays === 2) return "Travaillé";
  if (d?.workHalfDays === 1) return d.absenceHalfDays ? "Demi-journée + absence" : "Demi-journée";
  if (d && d.absenceHalfDays > 0) return "Absence";
  if (doc.holidays.has(date)) return "Férié";
  return "Non travaillé";
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FF1E6B4C" } };
  row.fill = HEADER_FILL;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function detailRows(doc: TimesheetDocument) {
  const last = new Date(Date.UTC(doc.year, doc.month1, 0)).getUTCDate();
  const rows = [];
  for (let i = 1; i <= last; i++) {
    const date = `${doc.year}-${String(doc.month1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
    const d = doc.days.find((x) => x.date === date);
    if (isWeekend(date) && !(d && d.workHalfDays + d.absenceHalfDays > 0)) continue;
    rows.push({
      date: new Date(`${date}T00:00:00Z`),
      weekday: WEEKDAYS[weekdayMon0(date)],
      freelancer: doc.freelancerName,
      nature: natureOf(doc, date),
      days: d ? d.workHalfDays / 2 : 0,
      overtime: d && d.workHalfDays > 0 ? d.overtimeHours : 0,
      onCall: d?.onCall && d.absenceHalfDays < 2 ? "Oui" : "",
      mission: doc.missionName,
      po: doc.poNumber,
    });
  }
  return rows;
}

function addDetailSheet(book: ExcelJS.Workbook, docs: TimesheetDocument[], withFreelancer: boolean) {
  const sheet = book.addWorksheet("Détail jours");
  sheet.columns = [
    { header: "Date", key: "date", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Jour", key: "weekday", width: 11 },
    ...(withFreelancer ? [{ header: "Freelance", key: "freelancer", width: 22 }] : []),
    { header: "Nature", key: "nature", width: 22 },
    { header: "Jours", key: "days", width: 8, style: { numFmt: "0.0" } },
    { header: "H. sup.", key: "overtime", width: 9 },
    { header: "Astreinte", key: "onCall", width: 10 },
    { header: "Mission", key: "mission", width: 24 },
    { header: "Bon de commande", key: "po", width: 18 },
  ];
  for (const doc of docs) sheet.addRows(detailRows(doc));
  styleHeader(sheet);
}

function addSummarySheet(book: ExcelJS.Workbook, docs: TimesheetDocument[]) {
  const sheet = book.addWorksheet("Synthèse");
  sheet.columns = [
    { header: "Freelance", key: "freelancer", width: 22 },
    { header: "Mission", key: "mission", width: 24 },
    { header: "PO", key: "po", width: 16 },
    { header: "Mois", key: "month", width: 10, style: { numFmt: "mm/yyyy" } },
    { header: "TJM", key: "rate", width: 11 },
    { header: "Jours", key: "days", width: 8, style: { numFmt: "0.0" } },
    { header: "H. sup.", key: "overtime", width: 9 },
    { header: "Astreintes", key: "onCall", width: 11 },
    { header: "Montant HT", key: "amount", width: 14 },
    { header: "Devise", key: "currency", width: 8 },
    { header: "Statut", key: "status", width: 12 },
    { header: "Code d'authenticité", key: "code", width: 26 },
  ];
  for (const doc of docs) {
    const row = sheet.addRow({
      freelancer: doc.freelancerName,
      mission: doc.missionName,
      po: doc.poNumber,
      month: new Date(Date.UTC(doc.year, doc.month1 - 1, 1)),
      rate: doc.rates.dailyRateCents / 100,
      days: doc.totals.workHalfDays / 2,
      overtime: doc.totals.overtimeHours,
      onCall: doc.totals.onCall,
      amount: doc.totals.amountCents / 100,
      status: STATUS_LABELS[doc.status],
      code: doc.authCode ?? "",
      currency: doc.currency,
    });
    row.getCell("rate").numFmt = money(doc.currency);
    row.getCell("amount").numFmt = money(doc.currency);
  }
  // Total uniquement si tous les CRA sont dans la même devise (pas d'addition de devises).
  if (docs.length > 1 && new Set(docs.map((d) => d.currency)).size === 1) {
    const total = sheet.addRow({
      freelancer: "Total",
      days: docs.reduce((s, d) => s + d.totals.workHalfDays, 0) / 2,
      amount: docs.reduce((s, d) => s + d.totals.amountCents, 0) / 100,
    });
    total.font = { bold: true };
    total.getCell("amount").numFmt = money(docs[0].currency);
  }
  styleHeader(sheet);
}

async function toBuffer(book: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await book.xlsx.writeBuffer());
}

function newBook() {
  const book = new ExcelJS.Workbook();
  book.creator = "Freelance Hub";
  book.created = new Date();
  return book;
}

export async function timesheetWorkbook(doc: TimesheetDocument): Promise<Buffer> {
  const book = newBook();
  addDetailSheet(book, [doc], false);
  addSummarySheet(book, [doc]);
  return toBuffer(book);
}

export async function monthlyWorkbook(docs: TimesheetDocument[]): Promise<Buffer> {
  const book = newBook();
  addSummarySheet(book, docs);
  addDetailSheet(book, docs, true);
  return toBuffer(book);
}
