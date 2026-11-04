import "server-only";
import type { CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { daysInMonth, formatDateTime, isoDate, shiftMonth, type IsoDate } from "@/lib/domain/calendar";
import type { EditableDay, Half, Period } from "@/lib/domain/cra-editor";
import { absenceWorkingDays } from "@/lib/domain/absences";
import type { Rates } from "@/lib/domain/timesheet";
import type { Prisma, TimesheetStatus } from "@/generated/prisma/client";

/** Date Postgres (@db.Date) → "YYYY-MM-DD". Prisma renvoie minuit UTC. */
export const toIso = (d: Date): IsoDate => d.toISOString().slice(0, 10);
export const fromIso = (iso: IsoDate) => new Date(`${iso}T00:00:00Z`);

export const EDITABLE_STATUSES: TimesheetStatus[] = ["DRAFT", "REJECTED"];
/** Statuts qui consomment le budget du PO */
export const CONSUMING_STATUSES: TimesheetStatus[] = ["SUBMITTED", "VALIDATED"];
/** Statuts pour lesquels les taux figés à la soumission font foi */
const SNAPSHOT_STATUSES: TimesheetStatus[] = ["SUBMITTED", "VALIDATED"];

export function monthBounds(year: number, month1: number) {
  return { first: isoDate(year, month1, 1), last: isoDate(year, month1, daysInMonth(year, month1)) };
}

const maxIso = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
const minIso = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const sameRates = (a: Rates, b: Rates) =>
  a.dailyRateCents === b.dailyRateCents &&
  a.overtimeHourlyRateCents === b.overtimeHourlyRateCents &&
  a.onCallRateCents === b.onCallRateCents;

/**
 * Imputations possibles d'un freelance sur un mois : une par bon de commande.
 * Un CRA est unique par (freelance, PO, mois) ; plusieurs contrats sur la même mission
 * (renouvellement, avenant en cours de mois) alimentent donc le même CRA. Les périodes
 * saisissables sont l'intersection mois ∩ contrat ∩ PO, pour chaque contrat.
 */
export async function assignmentsForMonth(freelancerId: string, year: number, month1: number) {
  const { first, last } = monthBounds(year, month1);
  const overlapsMonth = { startDate: { lte: fromIso(last) }, endDate: { gte: fromIso(first) } };
  const contracts = await db.contract.findMany({
    where: { freelancerId, ...overlapsMonth },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      dailyRateCents: true,
      overtimeHourlyRateCents: true,
      onCallRateCents: true,
      currency: true,
      mission: {
        select: {
          name: true,
          country: true,
          purchaseOrders: {
            where: overlapsMonth,
            orderBy: { startDate: "asc" },
            select: { id: true, number: true, budgetHalfDays: true, startDate: true, endDate: true },
          },
        },
      },
    },
  });

  type Assignment = {
    po: { id: string; number: string; budgetHalfDays: number };
    missionName: string;
    country: string;
    currency: string;
    periods: Period[];
    /** Contrat de référence (le plus récent) : rattaché au CRA, taux utilisés à la soumission */
    contract: { id: string } & Rates;
    mixedRates: boolean;
  };
  const byPo = new Map<string, Assignment>();

  for (const c of contracts) {
    const rates: Rates = {
      dailyRateCents: c.dailyRateCents,
      overtimeHourlyRateCents: c.overtimeHourlyRateCents,
      onCallRateCents: c.onCallRateCents,
    };
    for (const po of c.mission.purchaseOrders) {
      const start = maxIso(first, maxIso(toIso(c.startDate), toIso(po.startDate)));
      const end = minIso(last, minIso(toIso(c.endDate), toIso(po.endDate)));
      if (start > end) continue;
      const existing = byPo.get(po.id);
      if (!existing) {
        byPo.set(po.id, {
          po: { id: po.id, number: po.number, budgetHalfDays: po.budgetHalfDays },
          missionName: c.mission.name,
          country: c.mission.country,
          currency: c.currency,
          periods: [{ start, end }],
          contract: { id: c.id, ...rates },
          mixedRates: false,
        });
      } else {
        existing.periods.push({ start, end });
        existing.mixedRates ||= !sameRates(existing.contract, rates);
        existing.contract = { id: c.id, ...rates };
      }
    }
  }
  return [...byPo.values()];
}

export type Assignment = Awaited<ReturnType<typeof assignmentsForMonth>>[number];

export async function holidaysFor(country: string, year: number, month1: number, tx: Prisma.TransactionClient = db) {
  const { first, last } = monthBounds(year, month1);
  const rows = await tx.holiday.findMany({
    where: { country, date: { gte: fromIso(first), lte: fromIso(last) } },
    orderBy: { date: "asc" },
    select: { date: true, label: true, tentative: true },
  });
  return rows.map((h) => ({ date: toIso(h.date), label: h.label, tentative: h.tentative }));
}

/** Demi-journées restantes sur le PO, hors CRA courant (seuls les CRA soumis/validés consomment). */
export async function poRemainingHalfDays(
  po: { id: string; budgetHalfDays: number },
  excludeTimesheetId: string | null,
  tx: Prisma.TransactionClient = db,
) {
  const used = await tx.timesheet.aggregate({
    where: {
      purchaseOrderId: po.id,
      status: { in: CONSUMING_STATUSES },
      ...(excludeTimesheetId ? { id: { not: excludeTimesheetId } } : {}),
    },
    _sum: { totalWorkHalfDays: true },
  });
  return po.budgetHalfDays - (used._sum.totalWorkHalfDays ?? 0);
}

export const DAY_SELECT = {
  date: true,
  workHalfDays: true,
  absenceHalfDays: true,
  half: true,
  overtimeHours: true,
  onCall: true,
  comment: true,
  exceptionReason: true,
} as const;

export function toEditableDay(d: {
  date: Date;
  workHalfDays: number;
  absenceHalfDays: number;
  half: Half | null;
  overtimeHours: number;
  onCall: boolean;
  comment: string | null;
  exceptionReason: string | null;
}): EditableDay {
  return { ...d, date: toIso(d.date) };
}

/** Mois "YYYY-MM" du jour : pas de saisie au-delà. */
export const currentMonthKey = (today: IsoDate) => today.slice(0, 7);

/** Bornes de navigation : du premier mois sous contrat au mois courant (pas de saisie anticipée). */
async function navigationBounds(freelancerId: string, today: IsoDate) {
  const agg = await db.contract.aggregate({ where: { freelancerId }, _min: { startDate: true }, _max: { endDate: true } });
  const min = agg._min.startDate ? toIso(agg._min.startDate).slice(0, 7) : null;
  const maxContract = agg._max.endDate ? toIso(agg._max.endDate).slice(0, 7) : null;
  const current = currentMonthKey(today);
  return { min, max: maxContract && maxContract < current ? maxContract : current };
}

export type CraEditorData = NonNullable<Awaited<ReturnType<typeof loadCraEditor>>>;

/**
 * Données de l'écran de saisie pour le freelance connecté.
 * Renvoie null si l'utilisateur n'a pas de fiche freelance.
 */
export async function loadCraEditor(user: CurrentUser, year: number, month1: number, poId: string | undefined, today: IsoDate) {
  const freelancer = await db.freelancer.findUnique({
    where: { userId: user.id },
    select: { id: true, signature: { select: { uploadedAt: true } } },
  });
  if (!freelancer) return null;
  const signature = freelancer.signature ? { version: freelancer.signature.uploadedAt.getTime() } : null;

  const [assignments, bounds] = await Promise.all([
    assignmentsForMonth(freelancer.id, year, month1),
    navigationBounds(freelancer.id, today),
  ]);
  const key = (m: { year: number; month1: number }) => isoDate(m.year, m.month1, 1).slice(0, 7);
  const prev = key(shiftMonth(year, month1, -1));
  const next = key(shiftMonth(year, month1, 1));
  const nav = {
    prev: bounds.min && prev >= bounds.min ? prev : null,
    next: next <= bounds.max ? next : null,
  };
  const choices = assignments.map((a) => ({ poId: a.po.id, label: `${a.missionName} · ${a.po.number}` }));

  const assignment = assignments.find((a) => a.po.id === poId) ?? assignments[0];
  if (!assignment) return { year, month1, nav, choices, signature, editor: null };

  const timesheet = await db.timesheet.findUnique({
    where: {
      freelancerId_purchaseOrderId_month: {
        freelancerId: freelancer.id,
        purchaseOrderId: assignment.po.id,
        month: fromIso(isoDate(year, month1, 1)),
      },
    },
    select: {
      id: true,
      status: true,
      version: true,
      rejectionReason: true,
      submittedAt: true,
      validatedAt: true,
      dailyRateCents: true,
      overtimeHourlyRateCents: true,
      onCallRateCents: true,
      days: { orderBy: { date: "asc" }, select: DAY_SELECT },
    },
  });

  const { first, last } = monthBounds(year, month1);
  const [holidays, remaining, absences] = await Promise.all([
    holidaysFor(assignment.country, year, month1),
    poRemainingHalfDays(assignment.po, timesheet?.id ?? null),
    db.absence.findMany({
      where: { freelancerId: freelancer.id, startDate: { lte: fromIso(last) }, endDate: { gte: fromIso(first) } },
      select: { startDate: true, endDate: true },
    }),
  ]);
  // Jours ouvrés couverts par une absence déclarée (Lot 5), dans la période saisissable.
  const holidaySet = new Set(holidays.map((h) => h.date));
  const declaredAbsences = [
    ...new Set(
      absences.flatMap((a) =>
        absenceWorkingDays({ start: toIso(a.startDate), end: toIso(a.endDate) }, year, month1, holidaySet).filter((d) =>
          assignment.periods.some((p) => d >= p.start && d <= p.end),
        ),
      ),
    ),
  ].sort();

  // Taux figés une fois soumis/validé ; sinon (brouillon, correction demandée) taux du contrat en vigueur,
  // qui seront ceux figés à la prochaine soumission.
  const snapshot = timesheet && SNAPSHOT_STATUSES.includes(timesheet.status) && timesheet.dailyRateCents != null;
  const rates: Rates = snapshot
    ? {
        dailyRateCents: timesheet.dailyRateCents!,
        overtimeHourlyRateCents: timesheet.overtimeHourlyRateCents ?? 0,
        onCallRateCents: timesheet.onCallRateCents ?? 0,
      }
    : {
        dailyRateCents: assignment.contract.dailyRateCents,
        overtimeHourlyRateCents: assignment.contract.overtimeHourlyRateCents,
        onCallRateCents: assignment.contract.onCallRateCents,
      };

  return {
    year,
    month1,
    nav,
    choices,
    signature,
    editor: {
      /** Propriétaire de la saisie : clé de la copie locale hors ligne */
      ownerId: user.id,
      timesheetId: timesheet?.id ?? null,
      poId: assignment.po.id,
      missionName: assignment.missionName,
      poNumber: assignment.po.number,
      currency: assignment.currency,
      rates,
      mixedRates: assignment.mixedRates,
      periods: assignment.periods,
      /** Mois pas encore commencé : consultation seule */
      future: key({ year, month1 }) > currentMonthKey(today),
      holidays,
      declaredAbsences,
      poRemainingHalfDays: remaining,
      status: timesheet?.status ?? ("DRAFT" as TimesheetStatus),
      version: timesheet?.version ?? null,
      rejectionReason: timesheet?.rejectionReason ?? null,
      // Formatées côté serveur (fuseau métier) : cf. formatDateTime.
      submittedAt: timesheet?.submittedAt ? formatDateTime(timesheet.submittedAt, "long") : null,
      validatedAt: timesheet?.validatedAt ? formatDateTime(timesheet.validatedAt, "long") : null,
      days: (timesheet?.days ?? []).map(toEditableDay),
    },
  };
}
