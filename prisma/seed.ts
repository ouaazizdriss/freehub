/**
 * Données de démonstration (reprend les personnes et missions fictives de la maquette).
 * Idempotent : vide les tables puis recrée. NE PAS exécuter sur une base partagée.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type TimesheetStatus } from "../src/generated/prisma/client";
import { isoDate, monthDates, isWeekend, type IsoDate } from "../src/lib/domain/calendar";
import { computeTotals, type DayEntry } from "../src/lib/domain/timesheet";

if (process.env.NODE_ENV === "production") throw new Error("Seed de démo interdit en production");
const DEMO_DOMAIN = "@demo.freelancehub.local";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const date = (iso: IsoDate) => new Date(`${iso}T00:00:00Z`);
const eur = (n: number) => Math.round(n * 100);

// ---------- Jours fériés 2026 ----------
// Maroc : fêtes religieuses = dates estimées (calendrier lunaire), à confirmer à l'annonce officielle.
// Liste à faire valider par les RH avant mise en production.
const HOLIDAYS: { country: "MA" | "FR"; date: IsoDate; label: string; tentative?: boolean }[] = [
  { country: "MA", date: "2026-01-01", label: "Nouvel An" },
  { country: "MA", date: "2026-01-11", label: "Manifeste de l'Indépendance" },
  { country: "MA", date: "2026-01-14", label: "Nouvel An amazigh" },
  { country: "MA", date: "2026-03-20", label: "Aïd al-Fitr", tentative: true },
  { country: "MA", date: "2026-03-21", label: "Aïd al-Fitr (2e jour)", tentative: true },
  { country: "MA", date: "2026-05-01", label: "Fête du Travail" },
  { country: "MA", date: "2026-05-27", label: "Aïd al-Adha", tentative: true },
  { country: "MA", date: "2026-05-28", label: "Aïd al-Adha (2e jour)", tentative: true },
  { country: "MA", date: "2026-06-16", label: "1er Moharram", tentative: true },
  { country: "MA", date: "2026-07-30", label: "Fête du Trône" },
  { country: "MA", date: "2026-08-14", label: "Allégeance Oued Ed-Dahab" },
  { country: "MA", date: "2026-08-20", label: "Révolution du Roi et du Peuple" },
  { country: "MA", date: "2026-08-21", label: "Fête de la Jeunesse" },
  { country: "MA", date: "2026-08-25", label: "Aïd al-Mawlid", tentative: true },
  { country: "MA", date: "2026-08-26", label: "Aïd al-Mawlid (2e jour)", tentative: true },
  { country: "MA", date: "2026-10-31", label: "Fête de l'Unité", tentative: true },
  { country: "MA", date: "2026-11-06", label: "Marche Verte" },
  { country: "MA", date: "2026-11-18", label: "Fête de l'Indépendance" },
  { country: "FR", date: "2026-01-01", label: "Jour de l'an" },
  { country: "FR", date: "2026-04-06", label: "Lundi de Pâques" },
  { country: "FR", date: "2026-05-01", label: "Fête du Travail" },
  { country: "FR", date: "2026-05-08", label: "Victoire 1945" },
  { country: "FR", date: "2026-05-14", label: "Ascension" },
  { country: "FR", date: "2026-05-25", label: "Lundi de Pentecôte" },
  { country: "FR", date: "2026-07-14", label: "Fête nationale" },
  { country: "FR", date: "2026-08-15", label: "Assomption" },
  { country: "FR", date: "2026-11-01", label: "Toussaint" },
  { country: "FR", date: "2026-11-11", label: "Armistice 1918" },
  { country: "FR", date: "2026-12-25", label: "Noël" },
];

const STAFF = [
  { email: "manager@demo.freelancehub.local", name: "Mehdi Tazi", role: "MANAGER" as const },
  { email: "manager2@demo.freelancehub.local", name: "Salma Berrada", role: "MANAGER" as const },
  { email: "admin@demo.freelancehub.local", name: "Inès Lahlou", role: "ADMIN" as const },
  { email: "finance@demo.freelancehub.local", name: "Youssef Kettani", role: "FINANCE" as const },
];

// mission, PO, budget (j), manager, fin
const MISSIONS = [
  { name: "Refonte CRM", po: "PO-2026-0417", budgetDays: 480, manager: 0, end: "2026-12-31" },
  { name: "Agentic Center", po: "PO-2026-0502", budgetDays: 400, manager: 0, end: "2027-02-28" },
  { name: "Data Platform", po: "PO-2026-0311", budgetDays: 350, manager: 1, end: "2026-09-30" },
  { name: "Connect'in v3", po: "PO-2026-0450", budgetDays: 220, manager: 1, end: "2027-01-31" },
  { name: "Cyber — audit", po: "PO-2026-0288", budgetDays: 180, manager: 0, end: "2026-08-31" },
];

// nom, rôle, mission (index), TJM €, fin de contrat
const FREELANCERS = [
  { name: "Camille Rey", job: "Product designer", mission: 0, tjm: 620, end: "2026-12-31" },
  { name: "Karim Benali", job: "Data engineer", mission: 2, tjm: 640, end: "2026-09-30" },
  { name: "Léa Fontaine", job: "ML engineer", mission: 1, tjm: 710, end: "2027-02-28" },
  { name: "Thomas Marchand", job: "Consultant cyber", mission: 4, tjm: 780, end: "2026-08-31" },
  { name: "Sofia Amrani", job: "Dev front", mission: 3, tjm: 520, end: "2027-01-31" },
  { name: "Yanis Berger", job: "Dev back", mission: 0, tjm: 560, end: "2026-11-30" },
  { name: "Nadia Cherif", job: "UX researcher", mission: 3, tjm: 590, end: "2027-03-31" },
];

/** Signature de démonstration : le nom en écriture manuscrite, rendu en PNG dans le stockage privé. */
async function demoSignature(name: string): Promise<string> {
  const safe = name.replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="160"><text x="20" y="105" font-family="URW Chancery L, Z003, cursive" font-style="italic" font-size="64" fill="#1A1A2E">${safe}</text><path d="M20 125 C 160 140, 320 110, 480 128" stroke="#1A1A2E" stroke-width="3" fill="none"/></svg>`;
  const key = `signatures/${randomUUID()}.png`;
  const file = path.resolve(process.env.STORAGE_DIR ?? "storage", key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await sharp(Buffer.from(svg)).png().toBuffer());
  return key;
}

const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".");

/** Mois type : travaillé sur jours ouvrés, avec quelques variations déterministes. */
function buildMonth(year: number, month1: number, holidays: Set<IsoDate>, seed: number): DayEntry[] {
  return monthDates(year, month1)
    .filter((d) => !isWeekend(d))
    .map((d, i): DayEntry => {
      const base = { date: d, workHalfDays: 2, absenceHalfDays: 0, overtimeHours: 0, onCall: false };
      if (holidays.has(d)) return { ...base, workHalfDays: 0 };
      if ((i + seed) % 11 === 0) return { ...base, workHalfDays: 1, absenceHalfDays: 1 };
      if ((i + seed) % 13 === 5) return { ...base, overtimeHours: 2 + (seed % 3) };
      if ((i + seed) % 9 === 4) return { ...base, onCall: true };
      return base;
    });
}

async function main() {
  // Garde-fou : la remise à zéro efface tout. Refus si la base contient un compte réel
  // (hors domaine de démo), sauf SEED_FORCE=true explicite.
  const real = await db.user.count({ where: { NOT: { email: { endsWith: DEMO_DOMAIN } } } });
  if (real > 0 && process.env.SEED_FORCE !== "true") {
    throw new Error(`Refus : ${real} compte(s) réel(s) dans cette base. Seed réservé aux bases de démo (SEED_FORCE=true pour forcer).`);
  }

  // Remise à zéro : TRUNCATE (ne déclenche pas les triggers ligne à ligne qui verrouillent les CRA
  // soumis/validés — cf. migration lot6_lock_validated). Réservé aux bases de dev/test.
  await db.$executeRawUnsafe(
    `TRUNCATE "AuditLog", "ReminderLog", "TimesheetDay", "Timesheet", "Contract", "PurchaseOrder", "Mission",
      "Signature", "FreelancerDocument", "Absence", "Freelancer", "User", "Holiday" RESTART IDENTITY CASCADE`,
  );

  await db.holiday.createMany({
    data: HOLIDAYS.map((h) => ({ country: h.country, date: date(h.date), label: h.label, tentative: h.tentative ?? false })),
  });
  const maHolidays = new Set(HOLIDAYS.filter((h) => h.country === "MA").map((h) => h.date));

  const staff = await Promise.all(STAFF.map((s) => db.user.create({ data: s })));
  const managers = staff.filter((s) => s.role === "MANAGER");

  const missions = [];
  for (const m of MISSIONS) {
    const mission = await db.mission.create({
      data: {
        name: m.name,
        managerId: managers[m.manager].id,
        country: "MA",
        startDate: date("2026-01-01"),
        endDate: date(m.end),
        purchaseOrders: {
          create: { number: m.po, budgetHalfDays: m.budgetDays * 2, startDate: date("2026-01-01"), endDate: date(m.end) },
        },
      },
      include: { purchaseOrders: true },
    });
    missions.push(mission);
  }

  // Période de clôture en cours au 02/11/2026 : octobre 2026
  const period = { year: 2026, month1: 10 };
  const octoberStatus: TimesheetStatus[] = ["DRAFT", "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "DRAFT"];

  for (const [i, f] of FREELANCERS.entries()) {
    const mission = missions[f.mission];
    const po = mission.purchaseOrders[0];
    const user = await db.user.create({
      data: { email: `${slug(f.name)}@demo.freelancehub.local`, name: f.name, role: "FREELANCE" },
    });
    const freelancer = await db.freelancer.create({ data: { userId: user.id, jobTitle: f.job } });
    // Nadia n'a pas encore déposé de signature (cas « À déposer » de la démo).
    const signatureKey = f.name === "Nadia Cherif" ? null : await demoSignature(f.name);
    if (signatureKey) await db.signature.create({ data: { freelancerId: freelancer.id, fileKey: signatureKey, mimeType: "image/png" } });
    // Pièces justificatives (métadonnées seules) : cas variés pour le pilotage.
    const docs: { kind: "URSSAF" | "INSURANCE" | "KBIS"; expiresAt: string | null }[] = [
      { kind: "URSSAF", expiresAt: f.name === "Sofia Amrani" ? "2026-10-15" : "2027-03-31" },
      { kind: "INSURANCE", expiresAt: f.name === "Karim Benali" ? "2026-11-20" : "2027-06-30" },
      ...(f.name === "Nadia Cherif" ? [] : [{ kind: "KBIS" as const, expiresAt: null }]),
    ];
    // Absences de novembre (Gantt, impact capacitaire, report dans le CRA)
    const absences: Record<string, { kind: "LEAVE" | "UNAVAILABLE" | "SICK"; start: string; end: string; comment?: string }[]> = {
      "Camille Rey": [{ kind: "LEAVE", start: "2026-11-09", end: "2026-11-13", comment: "Congés posés" }],
      "Yanis Berger": [{ kind: "UNAVAILABLE", start: "2026-11-12", end: "2026-11-12", comment: "Formation" }],
      "Sofia Amrani": [{ kind: "SICK", start: "2026-11-02", end: "2026-11-03" }],
    };
    for (const a of absences[f.name] ?? []) {
      await db.absence.create({
        data: { freelancerId: freelancer.id, kind: a.kind, startDate: date(a.start), endDate: date(a.end), comment: a.comment ?? null },
      });
    }
    await db.freelancerDocument.createMany({
      data: docs.map((d) => ({ freelancerId: freelancer.id, kind: d.kind, expiresAt: d.expiresAt ? date(d.expiresAt) : null })),
    });
    const contract = await db.contract.create({
      data: {
        freelancerId: freelancer.id,
        missionId: mission.id,
        dailyRateCents: eur(f.tjm),
        overtimeHourlyRateCents: eur(95),
        onCallRateCents: eur(150),
        startDate: date("2026-01-01"),
        endDate: date(f.end),
      },
    });
    const rates = {
      dailyRateCents: contract.dailyRateCents,
      overtimeHourlyRateCents: contract.overtimeHourlyRateCents,
      onCallRateCents: contract.onCallRateCents,
    };

    // Septembre validé + octobre selon la file, pour les contrats encore actifs
    const months: { year: number; month1: number; status: TimesheetStatus }[] = [];
    if (f.end >= "2026-09-30") months.push({ year: 2026, month1: 9, status: "VALIDATED" });
    if (f.end >= isoDate(period.year, period.month1, 31)) months.push({ ...period, status: octoberStatus[i] });

    for (const m of months) {
      const days = buildMonth(m.year, m.month1, maHolidays, i + m.month1);
      const totals = computeTotals(days, rates);
      const submitted = m.status !== "DRAFT";
      // Créé en brouillon avec ses jours, puis passé à son statut : les triggers de verrouillage
      // (lot 6) refusent d'insérer des jours sous un CRA déjà soumis ou validé.
      const ts = await db.timesheet.create({
        data: {
          freelancerId: freelancer.id,
          purchaseOrderId: po.id,
          contractId: contract.id,
          month: date(isoDate(m.year, m.month1, 1)),
          status: "DRAFT",
          days: {
            create: days.map((d) => ({
              date: date(d.date),
              workHalfDays: d.workHalfDays,
              absenceHalfDays: d.absenceHalfDays,
              half: d.workHalfDays === 1 ? "AM" : null,
              overtimeHours: d.overtimeHours,
              onCall: d.onCall,
            })),
          },
        },
        select: { id: true },
      });
      await db.timesheet.update({
        where: { id: ts.id },
        data: {
          status: m.status,
          ...(submitted ? { ...rates, signatureKey } : {}),
          totalWorkHalfDays: totals.workHalfDays,
          totalAbsenceHalfDays: totals.absenceHalfDays,
          totalOvertimeHours: totals.overtimeHours,
          totalOnCall: totals.onCall,
          totalAmountCents: totals.amountCents,
          submittedAt: submitted ? new Date(Date.UTC(m.year, m.month1, 1, 17)) : null,
          validatedAt: m.status === "VALIDATED" ? new Date(Date.UTC(m.year, m.month1, 3, 8)) : null,
          validatedById: m.status === "VALIDATED" ? managers[MISSIONS[f.mission].manager].id : null,
        },
      });
    }
  }

  const counts = { users: await db.user.count(), timesheets: await db.timesheet.count(), days: await db.timesheetDay.count() };
  console.log("Seed OK", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
