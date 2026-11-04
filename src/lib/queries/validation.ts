import "server-only";
import type { CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { attentionPoints } from "@/lib/domain/attention";
import { BUSINESS_TIME_ZONE, formatDateTime, shiftMonth, todayIso } from "@/lib/domain/calendar";
import type { Prisma, Role, TimesheetStatus } from "@/generated/prisma/client";
import { assignmentsForMonth, CONSUMING_STATUSES, DAY_SELECT, holidaysFor, monthBounds, toEditableDay } from "./cra-editor";

/** Rôles qui voient la file ; seuls MANAGER (son périmètre) et ADMIN peuvent décider. */
export const VALIDATION_VIEWERS: readonly Role[] = ["MANAGER", "ADMIN", "FINANCE"];
export const VALIDATION_DECIDERS: readonly Role[] = ["MANAGER", "ADMIN"];

/** Périmètre : un manager ne voit que les CRA des missions dont il est responsable. */
export function timesheetScope(user: CurrentUser): Prisma.TimesheetWhereInput {
  if (user.role === "MANAGER") return { purchaseOrder: { mission: { managerId: user.id } } };
  if (user.role === "ADMIN" || user.role === "FINANCE") return {};
  return { id: "__none__" };
}

export function canDecide(user: CurrentUser) {
  return VALIDATION_DECIDERS.includes(user.role);
}

export const QUEUE_FILTERS = {
  SUBMITTED: { label: "À valider", statuses: ["SUBMITTED"] },
  VALIDATED: { label: "Validés", statuses: ["VALIDATED"] },
  REJECTED: { label: "À corriger", statuses: ["REJECTED"] },
  ALL: { label: "Tous", statuses: ["SUBMITTED", "VALIDATED", "REJECTED"] },
} as const satisfies Record<string, { label: string; statuses: TimesheetStatus[] }>;
export type QueueFilter = keyof typeof QUEUE_FILTERS;

export async function queueCounts(user: CurrentUser) {
  const rows = await db.timesheet.groupBy({ by: ["status"], where: timesheetScope(user), _count: true });
  const count = (s: TimesheetStatus) => rows.find((r) => r.status === s)?._count ?? 0;
  return {
    SUBMITTED: count("SUBMITTED"),
    VALIDATED: count("VALIDATED"),
    REJECTED: count("REJECTED"),
    ALL: count("SUBMITTED") + count("VALIDATED") + count("REJECTED"),
  } satisfies Record<QueueFilter, number>;
}

/** Taille max. de la liste affichée (le total est indiqué à côté) */
export const QUEUE_LIMIT = 200;

export async function listQueue(user: CurrentUser, filter: QueueFilter) {
  return db.timesheet.findMany({
    where: { ...timesheetScope(user), status: { in: [...QUEUE_FILTERS[filter].statuses] } },
    // File : plus ancien dépôt d'abord ; historique : plus récent d'abord.
    orderBy: filter === "SUBMITTED" ? [{ submittedAt: "asc" }, { id: "asc" }] : [{ month: "desc" }, { submittedAt: "desc" }],
    take: QUEUE_LIMIT,
    select: {
      id: true,
      month: true,
      status: true,
      submittedAt: true,
      totalWorkHalfDays: true,
      totalOvertimeHours: true,
      totalAmountCents: true,
      freelancer: { select: { user: { select: { name: true } } } },
      purchaseOrder: { select: { number: true, mission: { select: { name: true } } } },
    },
  });
}

export type QueueRow = Awaited<ReturnType<typeof listQueue>>[number];

/** Détail d'un CRA pour la validation, dans le périmètre de l'utilisateur (null sinon). */
export async function getValidationDetail(user: CurrentUser, id: string) {
  const ts = await db.timesheet.findFirst({
    where: { id, ...timesheetScope(user), status: { not: "DRAFT" } },
    select: {
      id: true,
      month: true,
      status: true,
      version: true,
      submittedAt: true,
      rejectionReason: true,
      dailyRateCents: true,
      totalWorkHalfDays: true,
      totalOvertimeHours: true,
      totalAmountCents: true,
      freelancerId: true,
      freelancer: { select: { user: { select: { name: true } } } },
      purchaseOrder: {
        select: { id: true, number: true, budgetHalfDays: true, mission: { select: { name: true, country: true } } },
      },
      days: { orderBy: { date: "asc" }, select: DAY_SELECT },
    },
  });
  if (!ts) return null;

  const year = ts.month.getUTCFullYear();
  const month1 = ts.month.getUTCMonth() + 1;
  const prev = shiftMonth(year, month1, -1);
  const [holidays, consumedOthers, previous, history, assignments] = await Promise.all([
    holidaysFor(ts.purchaseOrder.mission.country, year, month1),
    db.timesheet.aggregate({
      where: { purchaseOrderId: ts.purchaseOrder.id, status: { in: CONSUMING_STATUSES }, id: { not: ts.id } },
      _sum: { totalWorkHalfDays: true },
    }),
    db.timesheet.findFirst({
      where: {
        freelancerId: ts.freelancerId,
        purchaseOrderId: ts.purchaseOrder.id,
        month: new Date(Date.UTC(prev.year, prev.month1 - 1, 1)),
        status: { in: CONSUMING_STATUSES },
      },
      select: { totalAmountCents: true },
    }),
    db.auditLog.findMany({
      where: { entity: "Timesheet", entityId: ts.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, createdAt: true, payload: true, actor: { select: { name: true } } },
    }),
    assignmentsForMonth(ts.freelancerId, year, month1),
  ]);
  const { first, last } = monthBounds(year, month1);
  const periods = assignments.find((a) => a.po.id === ts.purchaseOrder.id)?.periods ?? [{ start: first, end: last }];
  const submittedOn = ts.submittedAt ? todayIso(BUSINESS_TIME_ZONE, ts.submittedAt) : null;

  const days = ts.days.map(toEditableDay);
  const points = attentionPoints({
    year,
    month1,
    days,
    holidays: new Set(holidays.map((h) => h.date)),
    periods,
    submittedOn,
    poConsumedOthersHalfDays: consumedOthers._sum.totalWorkHalfDays ?? 0,
    poBudgetHalfDays: ts.purchaseOrder.budgetHalfDays,
    previousAmountCents: previous?.totalAmountCents ?? null,
    amountCents: ts.totalAmountCents,
  });

  // DTO explicite : seuls les champs affichés partent vers le navigateur (pas d'e-mail, d'identifiants
  // internes, de budget PO ni de payload d'audit brut).
  return {
    id: ts.id,
    status: ts.status,
    version: ts.version,
    year,
    month1,
    freelancerName: ts.freelancer.user.name,
    missionName: ts.purchaseOrder.mission.name,
    poNumber: ts.purchaseOrder.number,
    rejectionReason: ts.rejectionReason,
    dailyRateCents: ts.dailyRateCents,
    totalWorkHalfDays: ts.totalWorkHalfDays,
    totalOvertimeHours: ts.totalOvertimeHours,
    totalAmountCents: ts.totalAmountCents,
    days,
    holidays,
    periods,
    points,
    history: history.map((h) => ({
      id: h.id,
      action: h.action,
      actorName: h.actor?.name ?? null,
      at: formatDateTime(h.createdAt),
      reason: h.action === "REJECT" ? reasonOf(h.payload) : null,
    })),
  };
}

function reasonOf(payload: unknown): string | null {
  return payload && typeof payload === "object" && "reason" in payload && typeof payload.reason === "string"
    ? payload.reason
    : null;
}

export type ValidationDetail = NonNullable<Awaited<ReturnType<typeof getValidationDetail>>>;
