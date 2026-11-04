"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { formatMonth, isoDate, todayIso } from "@/lib/domain/calendar";
import { sendMail, timesheetSubmittedMail } from "@/lib/notify";
import { onTimesheetSubmitted } from "@/lib/documents/lifecycle";
import {
  checkSubmission,
  isBlank,
  MAX_COMMENT_LENGTH,
  type EditableDay,
  type SubmissionIssue,
  type SubmissionIssueCode,
} from "@/lib/domain/cra-editor";
import { computeTotals } from "@/lib/domain/timesheet";
import {
  assignmentsForMonth,
  DAY_SELECT,
  EDITABLE_STATUSES,
  fromIso,
  holidaysFor,
  poRemainingHalfDays,
  toEditableDay,
} from "@/lib/queries/cra-editor";
import { Prisma } from "@/generated/prisma/client";

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const text = z.string().max(MAX_COMMENT_LENGTH).nullable();

const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workHalfDays: z.int().min(0).max(2),
  absenceHalfDays: z.int().min(0).max(2),
  half: z.enum(["AM", "PM"]).nullable(),
  overtimeHours: z.int().min(0).max(24),
  onCall: z.boolean(),
  comment: text,
  exceptionReason: text,
});

const saveSchema = z.object({
  poId: z.string().min(1),
  month: monthKey,
  version: z.int().nonnegative().nullable(),
  days: z.array(daySchema).max(31),
});

const submitSchema = z.object({ poId: z.string().min(1), month: monthKey, version: z.int().nonnegative() });

export type ActionError =
  | { ok: false; error: "INVALID"; issues: SubmissionIssue[] }
  | { ok: false; error: "CONFLICT" | "LOCKED" | "NOT_FOUND" };
export type SaveResult = { ok: true; version: number | null; savedAt: string } | ActionError;
export type SubmitResult = { ok: true } | ActionError;

/** Incohérences qui empêchent même l'enregistrement d'un brouillon (le reste n'est bloquant qu'à la soumission). */
const HARD_ISSUES = new Set<SubmissionIssueCode>([
  "HALF_DAYS_RANGE",
  "HALF_DAYS_EXCEED_DAY",
  "OVERTIME_RANGE",
  "OVERTIME_WITHOUT_WORK",
  "OUTSIDE_MONTH",
  "OUTSIDE_CONTRACT",
  "DUPLICATE_DATE",
  "COMMENT_TOO_LONG",
  "FUTURE_MONTH",
]);

/** Imputation (PO) du freelance connecté sur le mois : garantit qu'il ne touche qu'à ses propres CRA. */
async function resolveAssignment(userId: string, poId: string, month: string) {
  const [year, month1] = month.split("-").map(Number);
  const freelancer = await db.freelancer.findUnique({ where: { userId }, select: { id: true } });
  if (!freelancer) return null;
  const assignment = (await assignmentsForMonth(freelancer.id, year, month1)).find((a) => a.po.id === poId);
  if (!assignment) return null;
  return { freelancerId: freelancer.id, assignment, year, month1, monthDate: fromIso(isoDate(year, month1, 1)) };
}

/** Empreinte comparable d'un ensemble de journées (ordre et valeurs vides normalisés). */
function fingerprint(days: readonly EditableDay[]) {
  return JSON.stringify(
    [...days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => [d.date, d.workHalfDays, d.absenceHalfDays, d.half, d.overtimeHours, d.onCall, d.comment, d.exceptionReason]),
  );
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Autosave du brouillon : remplace l'ensemble des journées du CRA.
 * Verrou optimiste : `version` doit correspondre à celle en base (null = CRA pas encore créé).
 */
export async function saveDraft(input: z.input<typeof saveSchema>): Promise<SaveResult> {
  const user = await requireRole(["FREELANCE"]);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID", issues: [] };
  const { poId, month, version } = parsed.data;

  const ctx = await resolveAssignment(user.id, poId, month);
  if (!ctx) return { ok: false, error: "NOT_FOUND" };
  const { assignment, freelancerId, year, month1, monthDate } = ctx;
  const { contract, po } = assignment;

  const days: EditableDay[] = parsed.data.days
    .map((d) => ({ ...d, comment: d.comment?.trim() || null, exceptionReason: d.exceptionReason?.trim() || null }))
    .filter((d) => !isBlank(d))
    .map((d) => ({ ...d, half: d.workHalfDays === 1 ? (d.half ?? "AM") : null }));

  const holidays = new Set((await holidaysFor(assignment.country, year, month1)).map((h) => h.date));
  const check = checkSubmission(days, {
    year,
    month1,
    holidays,
    periods: assignment.periods,
    poRemainingHalfDays: Number.POSITIVE_INFINITY,
    today: todayIso(),
  });
  const hard = check.errors.filter((i) => HARD_ISSUES.has(i.code));
  if (hard.length > 0) return { ok: false, error: "INVALID", issues: hard };

  const totals = computeTotals(days, contract);

  try {
    return await db.$transaction(async (tx): Promise<SaveResult> => {
      const key = { freelancerId, purchaseOrderId: po.id, month: monthDate };
      let ts = await tx.timesheet.findUnique({
        where: { freelancerId_purchaseOrderId_month: key },
        select: { id: true, version: true, status: true },
      });

      if (!ts) {
        if (version !== null) return { ok: false, error: "CONFLICT" };
        if (days.length === 0) return { ok: true, version: null, savedAt: new Date().toISOString() };
        ts = await tx.timesheet.create({ data: { ...key, contractId: contract.id }, select: { id: true, version: true, status: true } });
        await tx.auditLog.create({ data: { actorId: user.id, entity: "Timesheet", entityId: ts.id, action: "CREATE" } });
      } else if (!EDITABLE_STATUSES.includes(ts.status)) {
        return { ok: false, error: "LOCKED" };
      } else if (ts.version !== version) {
        // Réponse précédente perdue (réseau) alors que l'écriture avait abouti : le client renvoie
        // le même contenu avec l'ancienne version. Ce n'est pas un conflit.
        if (version !== null && ts.version === version + 1) {
          const stored = await tx.timesheetDay.findMany({ where: { timesheetId: ts.id }, select: DAY_SELECT });
          if (fingerprint(stored.map(toEditableDay)) === fingerprint(days)) {
            return { ok: true, version: ts.version, savedAt: new Date().toISOString() };
          }
        }
        return { ok: false, error: "CONFLICT" };
      }

      // Écriture conditionnelle : échoue si une autre requête a modifié le CRA entre-temps.
      const updated = await tx.timesheet.updateMany({
        where: { id: ts.id, version: ts.version, status: { in: EDITABLE_STATUSES } },
        data: {
          version: { increment: 1 },
          contractId: contract.id,
          totalWorkHalfDays: totals.workHalfDays,
          totalAbsenceHalfDays: totals.absenceHalfDays,
          totalOvertimeHours: totals.overtimeHours,
          totalOnCall: totals.onCall,
          totalAmountCents: totals.amountCents,
        },
      });
      if (updated.count === 0) return { ok: false, error: "CONFLICT" };

      await tx.timesheetDay.deleteMany({ where: { timesheetId: ts.id } });
      await tx.timesheetDay.createMany({ data: days.map((d) => ({ ...d, date: fromIso(d.date), timesheetId: ts.id })) });
      return { ok: true, version: ts.version + 1, savedAt: new Date().toISOString() };
    });
  } catch (e) {
    // Création concurrente du même CRA (deux onglets) : la contrainte d'unicité tranche.
    if (isUniqueViolation(e)) return { ok: false, error: "CONFLICT" };
    throw e;
  }
}

/**
 * Soumission : rejoue tous les contrôles sur les données en base, fige les taux du contrat,
 * passe le CRA en SUBMITTED et journalise la transition.
 */
export async function submitTimesheet(input: z.input<typeof submitSchema>): Promise<SubmitResult> {
  const user = await requireRole(["FREELANCE"]);
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID", issues: [] };
  const { poId, month, version } = parsed.data;

  const ctx = await resolveAssignment(user.id, poId, month);
  if (!ctx) return { ok: false, error: "NOT_FOUND" };
  const { assignment, freelancerId, year, month1, monthDate } = ctx;
  const { contract, po } = assignment;

  const result = await db.$transaction(async (tx): Promise<SubmitResult> => {
    // Sérialise les soumissions sur un même PO : le contrôle du reste à consommer reste juste.
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${po.id} FOR UPDATE`;

    const [ts, signature] = await Promise.all([
      tx.timesheet.findUnique({
        where: { freelancerId_purchaseOrderId_month: { freelancerId, purchaseOrderId: po.id, month: monthDate } },
        select: { id: true, version: true, status: true, days: { select: DAY_SELECT } },
      }),
      tx.signature.findUnique({ where: { freelancerId }, select: { fileKey: true } }),
    ]);
    if (!ts) return { ok: false, error: "NOT_FOUND" };
    if (!EDITABLE_STATUSES.includes(ts.status)) return { ok: false, error: "LOCKED" };
    if (ts.version !== version) return { ok: false, error: "CONFLICT" };

    const days = ts.days.map(toEditableDay);
    const holidays = new Set((await holidaysFor(assignment.country, year, month1, tx)).map((h) => h.date));
    const { errors } = checkSubmission(days, {
      year,
      month1,
      holidays,
      periods: assignment.periods,
      mixedRates: assignment.mixedRates,
      hasSignature: !!signature,
      poRemainingHalfDays: await poRemainingHalfDays(po, ts.id, tx),
      today: todayIso(),
    });
    if (errors.length > 0) return { ok: false, error: "INVALID", issues: errors };

    const rates = {
      dailyRateCents: contract.dailyRateCents,
      overtimeHourlyRateCents: contract.overtimeHourlyRateCents,
      onCallRateCents: contract.onCallRateCents,
    };
    const totals = computeTotals(days, rates);
    const updated = await tx.timesheet.updateMany({
      where: { id: ts.id, version: ts.version, status: { in: EDITABLE_STATUSES } },
      data: {
        status: "SUBMITTED",
        version: { increment: 1 },
        contractId: contract.id,
        ...rates,
        totalWorkHalfDays: totals.workHalfDays,
        totalAbsenceHalfDays: totals.absenceHalfDays,
        totalOvertimeHours: totals.overtimeHours,
        totalOnCall: totals.onCall,
        totalAmountCents: totals.amountCents,
        submittedAt: new Date(),
        rejectionReason: null,
        // Signature figée : le PDF de ce CRA ne changera pas si le freelance remplace la sienne.
        signatureKey: signature!.fileKey,
      },
    });
    if (updated.count === 0) return { ok: false, error: "CONFLICT" };
    await onTimesheetSubmitted(tx, ts.id);

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        entity: "Timesheet",
        entityId: ts.id,
        action: "SUBMIT",
        payload: { ...totals, ...rates, fromStatus: ts.status },
      },
    });
    return { ok: true };
  });

  if (result.ok) {
    // Après la réponse et sans pouvoir faire échouer une soumission déjà enregistrée.
    after(() => notifyManager(po.id, user.name, year, month1).catch((e) => console.error("[notify] manager", e)));
    refresh();
  }
  return result;
}

/** Prévient le manager de la mission qu'un CRA attend sa validation (après commit, sans bloquer). */
async function notifyManager(poId: string, freelancer: string, year: number, month1: number) {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    select: { mission: { select: { name: true, manager: { select: { name: true, email: true, active: true } } } } },
  });
  const manager = po?.mission.manager;
  if (!manager?.active) return;
  await sendMail(
    timesheetSubmittedMail({
      to: manager.email,
      managerName: manager.name,
      freelancer,
      month: formatMonth(year, month1),
      mission: po!.mission.name,
    }),
  );
}
