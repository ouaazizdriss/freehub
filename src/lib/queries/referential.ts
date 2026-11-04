import "server-only";
import type { CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import {
  buildAlerts,
  documentStates,
  freelancerStatus,
  poHealth,
  type DocumentKind,
  type DocumentState,
  type FreelancerStatus,
} from "@/lib/domain/alerts";
import { closingPeriod, daysInMonth, formatMonth, isoDate, type IsoDate } from "@/lib/domain/calendar";
import type { Prisma, Role } from "@/generated/prisma/client";
import { CONSUMING_STATUSES, fromIso, toIso } from "./cra-editor";

/** Profils du référentiel : ADMIN (Achats) modifie, MANAGER consulte son périmètre. */
export const REFERENTIAL_VIEWERS: readonly Role[] = ["MANAGER", "ADMIN"];
export const REFERENTIAL_EDITORS: readonly Role[] = ["ADMIN"];
export const PILOTAGE_VIEWERS: readonly Role[] = ["MANAGER", "ADMIN", "FINANCE"];

/** Missions visibles : celles du manager, toutes pour Admin / Finance. */
export function missionScope(user: CurrentUser): Prisma.MissionWhereInput {
  if (user.role === "MANAGER") return { managerId: user.id };
  if (user.role === "ADMIN" || user.role === "FINANCE") return {};
  return { id: "__none__" };
}

/** Après la fin d'une collaboration, un manager garde l'accès à la fiche pendant cette durée (mois). */
const MANAGER_ACCESS_AFTER_CONTRACT_MONTHS = 6;

/**
 * Freelances visibles : pour un manager, ceux qui ont un contrat en cours sur l'une de ses missions,
 * ou terminé depuis moins de 6 mois (moindre privilège : pas d'accès indéfini aux pièces d'un ancien
 * prestataire). Admin et finance : tous.
 */
export function freelancerScope(user: CurrentUser): Prisma.FreelancerWhereInput {
  if (user.role === "ADMIN" || user.role === "FINANCE") return {};
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - MANAGER_ACCESS_AFTER_CONTRACT_MONTHS);
  return { contracts: { some: { mission: missionScope(user), endDate: { gte: since } } } };
}

async function poConsumption(poIds: string[]) {
  if (poIds.length === 0) return new Map<string, number>();
  const rows = await db.timesheet.groupBy({
    by: ["purchaseOrderId"],
    where: { purchaseOrderId: { in: poIds }, status: { in: CONSUMING_STATUSES } },
    _sum: { totalWorkHalfDays: true },
  });
  return new Map(rows.map((r) => [r.purchaseOrderId, r._sum.totalWorkHalfDays ?? 0]));
}

export type FreelancerRow = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  active: boolean;
  missionName: string | null;
  poNumber: string | null;
  dailyRateCents: number | null;
  currency: string;
  poBudgetHalfDays: number | null;
  poConsumedHalfDays: number | null;
  contractEnd: IsoDate | null;
  documents: Record<string, DocumentState>;
  status: FreelancerStatus;
};

/** Portefeuille : un freelance par ligne, avec son contrat de référence (en cours, sinon le plus récent). */
export async function listFreelancers(user: CurrentUser, today: IsoDate): Promise<FreelancerRow[]> {
  const freelancers = await db.freelancer.findMany({
    where: freelancerScope(user),
    orderBy: { user: { name: "asc" } },
    select: {
      id: true,
      jobTitle: true,
      user: { select: { name: true, email: true, active: true } },
      documents: { select: { kind: true, expiresAt: true } },
      contracts: {
        where: user.role === "MANAGER" ? { mission: missionScope(user) } : {},
        orderBy: { endDate: "desc" },
        select: {
          startDate: true,
          endDate: true,
          dailyRateCents: true,
          currency: true,
          mission: {
            select: {
              name: true,
              purchaseOrders: {
                orderBy: { endDate: "desc" },
                select: { id: true, number: true, budgetHalfDays: true, startDate: true, endDate: true },
              },
            },
          },
        },
      },
    },
  });

  const pick = (contracts: (typeof freelancers)[number]["contracts"]) =>
    contracts.find((c) => toIso(c.startDate) <= today && toIso(c.endDate) >= today) ?? contracts[0] ?? null;
  // PO de référence : celui qui couvre aujourd'hui, sinon le plus récent.
  const pickPo = (contract: ReturnType<typeof pick>) =>
    contract?.mission.purchaseOrders.find((p) => toIso(p.startDate) <= today && toIso(p.endDate) >= today) ??
    contract?.mission.purchaseOrders[0] ??
    null;
  const poIds = freelancers.flatMap((f) => pickPo(pick(f.contracts))?.id ?? []);
  const consumed = await poConsumption(poIds);

  return freelancers.map((f) => {
    const contract = pick(f.contracts);
    const po = pickPo(contract);
    const used = po ? (consumed.get(po.id) ?? 0) : null;
    const documents = documentStates(
      f.documents.map((d) => ({ kind: d.kind as DocumentKind, expiresAt: d.expiresAt ? toIso(d.expiresAt) : null })),
      today,
    );
    const contractEnd = contract ? toIso(contract.endDate) : null;
    return {
      id: f.id,
      name: f.user.name,
      email: f.user.email,
      jobTitle: f.jobTitle,
      active: f.user.active,
      missionName: contract?.mission.name ?? null,
      poNumber: po?.number ?? null,
      dailyRateCents: contract?.dailyRateCents ?? null,
      currency: contract?.currency ?? "EUR",
      poBudgetHalfDays: po?.budgetHalfDays ?? null,
      poConsumedHalfDays: used,
      contractEnd,
      documents,
      status: f.user.active
        ? freelancerStatus({
            contractEnd,
            poLevel: po ? poHealth(po.budgetHalfDays, used ?? 0).level : null,
            docs: documents,
            today,
          })
        : "INACTIVE",
    };
  });
}

/** Missions du périmètre avec leurs bons de commande et la consommation de chacun. */
export async function listMissions(user: CurrentUser) {
  const missions = await db.mission.findMany({
    where: missionScope(user),
    orderBy: [{ endDate: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      country: true,
      startDate: true,
      endDate: true,
      manager: { select: { id: true, name: true } },
      purchaseOrders: {
        orderBy: { startDate: "asc" },
        select: { id: true, number: true, budgetHalfDays: true, currency: true, startDate: true, endDate: true },
      },
      _count: { select: { contracts: true } },
    },
  });
  const consumed = await poConsumption(missions.flatMap((m) => m.purchaseOrders.map((p) => p.id)));
  return missions.map((m) => ({
    ...m,
    startDate: toIso(m.startDate),
    endDate: toIso(m.endDate),
    purchaseOrders: m.purchaseOrders.map((p) => ({
      ...p,
      startDate: toIso(p.startDate),
      endDate: toIso(p.endDate),
      consumedHalfDays: consumed.get(p.id) ?? 0,
    })),
  }));
}

/** Fiche freelance (dans le périmètre). */
export async function getFreelancer(user: CurrentUser, id: string) {
  const f = await db.freelancer.findFirst({
    where: { id, ...freelancerScope(user) },
    select: {
      id: true,
      jobTitle: true,
      company: true,
      siret: true,
      user: { select: { id: true, name: true, email: true, active: true } },
      documents: {
        orderBy: [{ kind: "asc" }, { expiresAt: "desc" }],
        select: { id: true, kind: true, expiresAt: true, fileName: true, sizeBytes: true, uploadedAt: true, fileKey: true },
      },
      contracts: {
        where: user.role === "MANAGER" ? { mission: missionScope(user) } : {},
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          dailyRateCents: true,
          overtimeHourlyRateCents: true,
          onCallRateCents: true,
          currency: true,
          mission: { select: { id: true, name: true } },
          _count: { select: { timesheets: true } },
          timesheets: { where: { status: { in: ["SUBMITTED", "VALIDATED"] } }, select: { month: true } },
        },
      },
    },
  });
  if (!f) return null;
  return {
    ...f,
    // Clé de stockage jamais transmise au navigateur
    documents: f.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      fileName: d.fileName,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
      expiresAt: d.expiresAt ? toIso(d.expiresAt) : null,
      hasFile: !!d.fileKey,
    })),
    contracts: f.contracts.map(({ timesheets, ...c }) => ({
      ...c,
      startDate: toIso(c.startDate),
      endDate: toIso(c.endDate),
      // Taux figés dès qu'un CRA est soumis ou validé (même règle que updateContract)
      submittedCount: timesheets.length,
    })),
  };
}

export async function listManagers() {
  return db.user.findMany({
    where: { role: "MANAGER", active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function listMissionOptions() {
  return db.mission.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, startDate: true, endDate: true } });
}

// ---------- Tableau de bord ----------

type Expected = { freelancer: string; freelancerId: string; mission: string; poId: string };

/**
 * CRA attendus sur un mois : un par (freelance, bon de commande) dont la période
 * mois ∩ contrat ∩ PO n'est pas vide — même règle que l'écran de saisie (assignmentsForMonth).
 * Freelances désactivés exclus.
 */
export async function expectedTimesheets(scope: Prisma.MissionWhereInput, year: number, month1: number) {
  const first = fromIso(isoDate(year, month1, 1));
  const last = fromIso(isoDate(year, month1, daysInMonth(year, month1)));
  const [contracts, timesheets] = await Promise.all([
    db.contract.findMany({
      where: { mission: scope, startDate: { lte: last }, endDate: { gte: first }, freelancer: { user: { active: true } } },
      select: {
        freelancerId: true,
        startDate: true,
        endDate: true,
        freelancer: { select: { user: { select: { name: true, email: true } } } },
        mission: {
          select: {
            name: true,
            purchaseOrders: {
              where: { startDate: { lte: last }, endDate: { gte: first } },
              select: { id: true, startDate: true, endDate: true },
            },
          },
        },
      },
    }),
    db.timesheet.findMany({
      where: { month: first, purchaseOrder: { mission: scope } },
      select: { freelancerId: true, purchaseOrderId: true, status: true, totalWorkHalfDays: true },
    }),
  ]);
  const expected = new Map<string, Expected & { email: string }>();
  for (const c of contracts) {
    for (const po of c.mission.purchaseOrders) {
      const start = Math.max(c.startDate.getTime(), po.startDate.getTime(), first.getTime());
      const end = Math.min(c.endDate.getTime(), po.endDate.getTime(), last.getTime());
      if (start > end) continue;
      expected.set(`${c.freelancerId}:${po.id}`, {
        freelancer: c.freelancer.user.name,
        email: c.freelancer.user.email,
        freelancerId: c.freelancerId,
        mission: c.mission.name,
        poId: po.id,
      });
    }
  }
  const statusOf = new Map(timesheets.map((t) => [`${t.freelancerId}:${t.purchaseOrderId}`, t.status]));
  let validated = 0;
  let toValidate = 0;
  const missing: (Expected & { email: string })[] = [];
  for (const [key, e] of expected) {
    const s = statusOf.get(key);
    if (s === "VALIDATED") validated++;
    else if (s === "SUBMITTED") toValidate++;
    else missing.push(e);
  }
  const billedHalfDays = timesheets
    .filter((t) => CONSUMING_STATUSES.includes(t.status))
    .reduce((s, t) => s + t.totalWorkHalfDays, 0);
  return { expected: expected.size, validated, toValidate, missing, billedHalfDays };
}

/** Données du pilotage pour la période de clôture en cours, dans le périmètre de l'utilisateur. */
export async function dashboard(user: CurrentUser, today: IsoDate) {
  const period = closingPeriod(today);
  // Période précédente : son échéance (le 5 de ce mois) peut être passée avec des CRA manquants.
  const previous = closingPeriod(isoDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1));
  const scope = missionScope(user);
  const activeOnly = { freelancer: { user: { active: true } } };

  const [missions, activeContracts, closing, previousClosing, documents] = await Promise.all([
    listMissions(user),
    db.contract.findMany({
      where: { mission: scope, startDate: { lte: fromIso(today) }, endDate: { gte: fromIso(today) }, ...activeOnly },
      select: {
        endDate: true,
        freelancerId: true,
        missionId: true,
        freelancer: { select: { user: { select: { name: true } } } },
        mission: { select: { name: true } },
      },
    }),
    expectedTimesheets(scope, period.year, period.month1),
    previous.month1 !== period.month1 || previous.year !== period.year
      ? expectedTimesheets(scope, previous.year, previous.month1)
      : Promise.resolve(null),
    db.freelancer.findMany({
      where: { contracts: { some: { mission: scope, endDate: { gte: fromIso(today) } } }, user: { active: true } },
      select: { id: true, user: { select: { name: true } }, documents: { select: { kind: true, expiresAt: true } } },
    }),
  ]);

  // Retard : CRA de la période précédente toujours non déposés après son échéance.
  const late = previousClosing && today > previous.deadline ? previousClosing.missing : [];
  const lateLabel = formatMonth(previous.year, previous.month1).replace(/^./, (c) => c.toUpperCase());

  const activePos = missions.flatMap((m) =>
    m.purchaseOrders.filter((p) => p.endDate >= today).map((p) => ({ ...p, mission: m.name })),
  );
  const budget = activePos.reduce((s, p) => s + p.budgetHalfDays, 0);
  const consumed = activePos.reduce((s, p) => s + p.consumedHalfDays, 0);
  const closingLabel = formatMonth(period.year, period.month1).replace(/^./, (c) => c.toUpperCase());

  const alerts = buildAlerts({
    today,
    closingLabel: lateLabel,
    purchaseOrders: activePos.map((p) => ({
      number: p.number,
      mission: p.mission,
      budgetHalfDays: p.budgetHalfDays,
      consumedHalfDays: p.consumedHalfDays,
    })),
    contracts: activeContracts.map((c) => ({
      freelancer: c.freelancer.user.name,
      freelancerId: c.freelancerId,
      mission: c.mission.name,
      endDate: toIso(c.endDate),
    })),
    documents: documents.map((f) => ({
      freelancer: f.user.name,
      freelancerId: f.id,
      states: documentStates(
        f.documents.map((d) => ({ kind: d.kind as DocumentKind, expiresAt: d.expiresAt ? toIso(d.expiresAt) : null })),
        today,
      ),
    })),
    late,
  });

  return {
    period: { ...period, label: closingLabel },
    late: { label: lateLabel, deadline: previous.deadline, count: late.length },
    kpis: {
      activeFreelancers: new Set(activeContracts.map((c) => c.freelancerId)).size,
      activeMissions: new Set(activeContracts.map((c) => c.missionId)).size,
      billedHalfDays: closing.billedHalfDays,
      budgetHalfDays: budget,
      consumedHalfDays: consumed,
      late: late.length,
      missing: closing.missing.length,
    },
    closing: {
      expected: closing.expected,
      validated: closing.validated,
      toValidate: closing.toValidate,
      missing: closing.missing.length,
    },
    missions: activePos.map((p) => ({
      id: p.id,
      mission: p.mission,
      po: p.number,
      budgetHalfDays: p.budgetHalfDays,
      consumedHalfDays: p.consumedHalfDays,
      level: poHealth(p.budgetHalfDays, p.consumedHalfDays).level,
    })),
    alerts,
  };
}
