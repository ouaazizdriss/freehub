import "server-only";
import bwipjs from "bwip-js/node";
import PDFDocument from "pdfkit";
import { formatMonth, isWeekend, weekdayMon0, type IsoDate } from "@/lib/domain/calendar";
import { formatDays, formatEur } from "@/lib/domain/timesheet";
import { appUrl } from "@/lib/notify";
import { getFile } from "@/lib/storage";
import type { TimesheetDocument } from "./content";

/**
 * PDF officiel du CRA — une seule page A4, générée côté serveur (pdfkit, polices standard).
 * Mise en page d'après le handoff (section « PDF du CRA ») :
 * bandeau provisoire, métadonnées, jours sur deux colonnes, totaux, signatures, code-barres.
 */

const C = {
  purple: "#6F259F",
  purpleDeep: "#4E1A73",
  tint: "#F8E7F9",
  soft: "#FBF8FC",
  ink: "#1A1A2E",
  muted: "#6E6680",
  line: "#EFE9F3",
  warnBg: "#FEF0D8",
  warnLine: "#E0B45C",
  warnInk: "#8A6212",
  okBg: "#F1FAF5",
  okInk: "#1E6B4C",
  dashed: "#D9CEE2",
};

const PAGE = { w: 595.28, h: 841.89, mx: 40, my: 36 };
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Caractères hors Latin-1 présents dans WinAnsi (encodage des polices PDF standard). */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const FALLBACK: Record<string, string> = { Ł: "L", ł: "l", Đ: "D", đ: "d", ı: "i", Ø: "O", ø: "o", ß: "ss" };

/**
 * Texte imprimable avec les polices standard : espace fine insécable → insécable, caractères
 * hors WinAnsi translittérés (Łukasz → Lukasz) ou remplacés par « ? » plutôt qu'imprimés en charabia.
 */
export function t(input: string): string {
  let out = "";
  for (const ch of input.replace(/\u202f/g, "\u00a0")) {
    const code = ch.codePointAt(0)!;
    if (code <= 0xff || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (FALLBACK[ch]) out += FALLBACK[ch];
    else {
      const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      out += base && [...base].every((c) => c.codePointAt(0)! <= 0xff) ? base : "?";
    }
  }
  return out;
}

/** Tronque un texte (avec « … ») pour qu'il tienne sur une ligne de la largeur donnée. */
function fit(pdf: PDFKit.PDFDocument, text: string, width: number): string {
  const value = t(text);
  if (pdf.widthOfString(value) <= width) return value;
  let cut = value;
  while (cut.length > 1 && pdf.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function dayRows(doc: TimesheetDocument) {
  const byDate = new Map(doc.days.map((d) => [d.date, d]));
  const dates: IsoDate[] = [];
  const last = new Date(Date.UTC(doc.year, doc.month1, 0)).getUTCDate();
  for (let i = 1; i <= last; i++) {
    const date = `${doc.year}-${String(doc.month1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
    const entry = byDate.get(date);
    // Jours ouvrés + week-ends saisis (dérogation)
    if (!isWeekend(date) || (entry && entry.workHalfDays + entry.absenceHalfDays > 0)) dates.push(date);
  }
  return dates.map((date) => {
    const d = byDate.get(date);
    const holiday = doc.holidays.get(date);
    let nature = "Non travaillé";
    if (d?.workHalfDays === 2) nature = holiday || isWeekend(date) ? "Travaillé (dérogation)" : "Travaillé";
    else if (d?.workHalfDays === 1)
      nature = `Demi-journée (${d.half === "PM" ? "après-midi" : "matin"})${d.absenceHalfDays ? " + absence" : ""}`;
    else if (d && d.absenceHalfDays > 0) nature = "Absence";
    else if (holiday) nature = `Férié — ${holiday}`;
    return {
      label: `${WEEKDAYS[weekdayMon0(date)]} ${date.slice(8)}/${date.slice(5, 7)}`,
      nature,
      days: d && d.workHalfDays > 0 ? formatDays(d.workHalfDays) : "",
      ot: d && d.workHalfDays > 0 && d.overtimeHours > 0 ? `${d.overtimeHours}` : "",
      onCall: d?.onCall && d.absenceHalfDays < 2 ? "Oui" : "",
    };
  });
}

export async function renderTimesheetPdf(doc: TimesheetDocument): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    margin: 0,
    info: { Title: t(`CRA ${formatMonth(doc.year, doc.month1)} — ${doc.freelancerName}`), Author: "Freelance Hub" },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));

  const validated = doc.status === "VALIDATED";
  const eur = (c: number) => t(formatEur(c, doc.currency));
  const x0 = PAGE.mx;
  const width = PAGE.w - PAGE.mx * 2;
  let y = PAGE.my;

  // Filigrane provisoire
  if (!validated) {
    pdf.save();
    pdf.rotate(-35, { origin: [PAGE.w / 2, PAGE.h / 2] });
    pdf.fillColor(C.purple).fillOpacity(0.06).font("Helvetica-Bold").fontSize(96);
    pdf.text(doc.status === "DRAFT" || doc.status === "REJECTED" ? "BROUILLON" : "PROVISOIRE", 0, PAGE.h / 2 - 50, {
      width: PAGE.w,
      align: "center",
    });
    pdf.restore();
    pdf.fillOpacity(1);
  }

  // En-tête
  pdf.fillColor(C.ink).font("Helvetica-Bold").fontSize(15).text("Compte rendu d'activité", x0, y);
  pdf
    .font("Helvetica")
    .fontSize(9)
    .fillColor(C.muted)
    .text(
      t(formatMonth(doc.year, doc.month1)).replace(/^./, (c) => c.toUpperCase()),
      x0,
      y + 19,
    );
  pdf.font("Helvetica-Bold").fontSize(9.5).fillColor(C.ink).text("Freelance Hub", x0, y, { width, align: "right" });
  pdf
    .font("Courier")
    .fontSize(8)
    .fillColor(C.muted)
    .text(doc.authCode ?? "Non soumis — sans code", x0, y + 13, { width, align: "right" });
  y += 34;
  pdf
    .moveTo(x0, y)
    .lineTo(x0 + width, y)
    .lineWidth(2)
    .strokeColor(C.purple)
    .stroke();
  y += 10;

  // Bandeau de statut
  if (!validated) {
    const text =
      doc.status === "SUBMITTED" ? "Document provisoire — en attente de validation manager" : "Brouillon — document non soumis";
    pdf.save().rect(x0, y, width, 20).fillColor(C.warnBg).fill().restore();
    pdf.rect(x0, y, width, 20).dash(3, { space: 2 }).lineWidth(1).strokeColor(C.warnLine).stroke().undash();
    pdf
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(C.warnInk)
      .text(text.toUpperCase(), x0, y + 6.5, { width, align: "center", characterSpacing: 1.2 });
    y += 28;
  }

  // Métadonnées
  const meta: [string, string][] = [
    ["Freelance", doc.freelancerName + (doc.company ? ` (${doc.company})` : "")],
    ["Mission", doc.missionName],
    ["Bon de commande", doc.poNumber],
    ["TJM", eur(doc.rates.dailyRateCents)],
    ["Période", t(formatMonth(doc.year, doc.month1))],
  ];
  const colW = width / meta.length;
  meta.forEach(([label, value], i) => {
    pdf
      .font("Helvetica")
      .fontSize(7)
      .fillColor(C.muted)
      .text(label.toUpperCase(), x0 + i * colW, y, { width: colW - 6, characterSpacing: 0.6 });
    pdf.font("Helvetica-Bold").fontSize(9).fillColor(C.ink);
    pdf.text(fit(pdf, value, colW - 6), x0 + i * colW, y + 10, { lineBreak: false });
  });
  y += 30;

  // Tableau des jours, deux colonnes côte à côte
  const rows = dayRows(doc);
  const half = Math.ceil(rows.length / 2);
  const gap = 16;
  const tableW = (width - gap) / 2;
  const cols = [
    { title: "Date", w: 0.22 },
    { title: "Nature", w: 0.5 },
    { title: "J.", w: 0.09, right: true },
    { title: "HS", w: 0.09, right: true },
    { title: "Ast.", w: 0.1, right: true },
  ];
  // Interligne réduit plutôt que pagination si le mois est long (contrainte : une page).
  const rowH = half > 14 ? 12 : 13.5;
  const drawTable = (list: typeof rows, tx: number) => {
    let ty = y;
    pdf.save().rect(tx, ty, tableW, 14).fillColor(C.tint).fill().restore();
    let cx = tx;
    for (const col of cols) {
      pdf
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(C.purple)
        .text(col.title, cx + 4, ty + 4, {
          width: col.w * tableW - 8,
          align: col.right ? "right" : "left",
        });
      cx += col.w * tableW;
    }
    ty += 14;
    for (const r of list) {
      cx = tx;
      [r.label, r.nature, r.days, r.ot, r.onCall].forEach((value, i) => {
        const w = cols[i].w * tableW - 8;
        pdf
          .font(i === 0 ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7.8)
          .fillColor(C.ink);
        const fitted = fit(pdf, value, w);
        const dx = cols[i].right ? w - pdf.widthOfString(fitted) : 0;
        pdf.text(fitted, cx + 4 + dx, ty + 3, { lineBreak: false });
        cx += cols[i].w * tableW;
      });
      ty += rowH;
      pdf
        .moveTo(tx, ty)
        .lineTo(tx + tableW, ty)
        .lineWidth(0.5)
        .strokeColor(C.line)
        .stroke();
    }
    return ty;
  };
  const bottomLeft = drawTable(rows.slice(0, half), x0);
  const bottomRight = drawTable(rows.slice(half), x0 + tableW + gap);
  y = Math.max(bottomLeft, bottomRight) + 12;

  // Totaux
  const totalsW = 270;
  const tx = x0 + width - totalsW;
  const lines: [string, string][] = [
    ["Jours travaillés", `${t(formatDays(doc.totals.workHalfDays))} j × ${eur(doc.rates.dailyRateCents)}`],
    ["Heures supplémentaires", `${doc.totals.overtimeHours} h × ${eur(doc.rates.overtimeHourlyRateCents)}`],
    ["Astreintes", `${doc.totals.onCall} × ${eur(doc.rates.onCallRateCents)}`],
  ];
  const boxH = 16 + lines.length * 14 + 24;
  pdf.save().roundedRect(tx, y, totalsW, boxH, 6).fillColor(C.soft).fill().restore();
  let ly = y + 10;
  for (const [label, value] of lines) {
    pdf
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(C.muted)
      .text(label, tx + 12, ly);
    pdf
      .font("Helvetica-Bold")
      .fillColor(C.ink)
      .text(value, tx + 12, ly, { width: totalsW - 24, align: "right" });
    ly += 14;
  }
  pdf
    .moveTo(tx + 12, ly + 2)
    .lineTo(tx + totalsW - 12, ly + 2)
    .lineWidth(0.8)
    .strokeColor(C.dashed)
    .stroke();
  pdf
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(C.purpleDeep)
    .text("Total à facturer HT", tx + 12, ly + 9);
  pdf.text(eur(doc.totals.amountCents), tx + 12, ly + 9, { width: totalsW - 24, align: "right" });

  // Pied : code-barres + mention de vérification
  const footerY = PAGE.h - PAGE.my - 52;
  if (doc.authCode) {
    const png = await bwipjs.toBuffer({ bcid: "code128", text: doc.authCode, scale: 2, height: 10, includetext: false });
    pdf.image(png, x0, footerY, { fit: [210, 38] });
    pdf
      .font("Courier-Bold")
      .fontSize(8)
      .fillColor(C.ink)
      .text(doc.authCode, x0, footerY + 42, { characterSpacing: 1.2 });
    pdf
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(
        `Authenticité : scannez le code-barres ou saisissez la référence sur ${appUrl("/verify")}. ` +
          "Le code change si le document est modifié ou si son statut de validation évolue ; il ne se vérifie plus après une demande de correction.",
        x0 + 230,
        footerY + 4,
        { width: width - 230 },
      );
  } else {
    pdf
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C.muted)
      .text(
        "Document non soumis : aucun code d'authenticité. Seul le PDF d'un CRA soumis ou validé fait foi.",
        x0,
        footerY + 20,
        { width },
      );
  }

  // Signatures, au-dessus du pied de page
  const sigH = 104;
  const sigY = footerY - sigH - 34;
  const sigW = (width - 20) / 2;
  pdf.font("Helvetica-Bold").fontSize(8).fillColor(C.muted).text("LE PRESTATAIRE", x0, sigY, { characterSpacing: 1 });
  pdf.font("Helvetica-Bold").text("LE MANAGER", x0 + sigW + 20, sigY, { characterSpacing: 1 });
  const boxY = sigY + 13;
  pdf.roundedRect(x0, boxY, sigW, sigH, 6).lineWidth(1).strokeColor(C.line).stroke();
  const signature = doc.signatureKey ? await getFile(doc.signatureKey) : null;
  if (signature) {
    pdf.image(signature, x0 + 10, boxY + 8, { fit: [sigW - 20, sigH - 30], align: "center", valign: "center" });
  }
  const frozen = doc.status === "SUBMITTED" || doc.status === "VALIDATED";
  const caption = !frozen ? "non signé (brouillon)" : signature ? "signé à la soumission" : "signature non disponible";
  pdf.font("Helvetica").fontSize(7.5).fillColor(C.muted);
  pdf.text(fit(pdf, `${doc.freelancerName} — ${caption}`, sigW - 20), x0 + 10, boxY + sigH - 16, {
    width: sigW - 20,
    align: "center",
  });

  const mx = x0 + sigW + 20;
  if (validated) {
    pdf.save().roundedRect(mx, boxY, sigW, sigH, 6).fillColor(C.okBg).fill().restore();
    pdf.roundedRect(mx, boxY, sigW, sigH, 6).lineWidth(1.2).strokeColor(C.okInk).stroke();
    pdf
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor(C.okInk)
      .text("VALIDÉ", mx, boxY + 30, { width: sigW, align: "center", characterSpacing: 2 });
    const when = doc.validatedAt
      ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(
          doc.validatedAt,
        )
      : "";
    pdf
      .font("Helvetica")
      .fontSize(7.5)
      .text(fit(pdf, `Validé le ${when} par ${doc.validatedByName ?? doc.managerName}`, sigW - 16), mx + 8, boxY + 58, {
        width: sigW - 16,
        align: "center",
      });
    pdf.text("Signature électronique Freelance Hub", mx + 8, boxY + 70, { width: sigW - 16, align: "center" });
  } else {
    pdf.roundedRect(mx, boxY, sigW, sigH, 6).dash(4, { space: 3 }).lineWidth(1).strokeColor(C.dashed).stroke().undash();
    pdf
      .font("Helvetica")
      .fontSize(8)
      .fillColor(C.muted)
      .text("En attente de validation", mx, boxY + sigH / 2 - 4, { width: sigW, align: "center" });
  }

  pdf.end();
  return done;
}
