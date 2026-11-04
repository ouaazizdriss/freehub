import "server-only";
import type { CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import type { EditableDay } from "@/lib/domain/cra-editor";
import { computeTotals, type Rates, type Totals } from "@/lib/domain/timesheet";
import type { Prisma, TimesheetStatus } from "@/generated/prisma/client";
import { DAY_SELECT, holidaysFor, toEditableDay } from "@/lib/queries/cra-editor";
import { timesheetScope } from "@/lib/queries/validation";
import { getFile } from "@/lib/storage";
import { authCodeSecret, computeAuthCode, sha256 } from "./auth-code";

const FROZEN: TimesheetStatus[] = ["SUBMITTED", "VALIDATED"];

/**
 * Accès à un CRA pour les documents (PDF, Excel) : le freelance titulaire (y compris brouillon),
 * ou un profil de pilotage dans son périmètre, pour les CRA soumis, validés ou renvoyés
 * (jamais un brouillon en cours de saisie).
 */
export function documentScope(user: CurrentUser): Prisma.TimesheetWhereInput {
  return user.role === "FREELANCE" ? { freelancer: { userId: user.id } } : { ...timesheetScope(user), status: { not: "DRAFT" } };
}

const DOCUMENT_SELECT = {
  id: true,
  status: true,
  month: true,
  submittedAt: true,
  validatedAt: true,
  authCode: true,
  signatureKey: true,
  snapshot: true,
  dailyRateCents: true,
  overtimeHourlyRateCents: true,
  onCallRateCents: true,
  totalWorkHalfDays: true,
  totalAbsenceHalfDays: true,
  totalOvertimeHours: true,
  totalOnCall: true,
  totalAmountCents: true,
  validatedBy: { select: { name: true } },
  contract: { select: { dailyRateCents: true, overtimeHourlyRateCents: true, onCallRateCents: true, currency: true } },
  freelancer: {
    select: { company: true, user: { select: { name: true } }, signature: { select: { fileKey: true } } },
  },
  purchaseOrder: {
    select: { number: true, mission: { select: { name: true, country: true, manager: { select: { name: true } } } } },
  },
  days: { orderBy: { date: "asc" }, select: DAY_SELECT },
} satisfies Prisma.TimesheetSelect;

/** Contenu affiché figé sur le CRA à la soumission (puis complété à la validation). */
export type DocumentSnapshot = {
  freelancerName: string;
  company: string | null;
  missionName: string;
  poNumber: string;
  managerName: string;
  currency: string;
  /** SHA-256 de l'image de signature figée (une image remplacée ou supprimée est détectée) */
  signatureHash: string | null;
  validatedByName?: string | null;
};

export type TimesheetDocument = DocumentSnapshot & {
  id: string;
  status: TimesheetStatus;
  year: number;
  month1: number;
  rates: Rates;
  totals: Totals;
  days: EditableDay[];
  holidays: Map<string, string>;
  submittedAt: Date | null;
  validatedAt: Date | null;
  authCode: string | null;
  /** Signature figée à la soumission ; pour un brouillon, la signature courante (aperçu) */
  signatureKey: string | null;
};

type Row = Prisma.TimesheetGetPayload<{ select: typeof DOCUMENT_SELECT }>;

function asSnapshot(value: Prisma.JsonValue | null): DocumentSnapshot | null {
  return value && typeof value === "object" && !Array.isArray(value) && "freelancerName" in value
    ? (value as unknown as DocumentSnapshot)
    : null;
}

/** Contenu tel qu'il s'afficherait aujourd'hui (brouillon, ou figeage à la soumission). */
async function liveSnapshot(row: Row, signatureKey: string | null): Promise<DocumentSnapshot> {
  const file = signatureKey ? await getFile(signatureKey) : null;
  return {
    freelancerName: row.freelancer.user.name,
    company: row.freelancer.company,
    missionName: row.purchaseOrder.mission.name,
    poNumber: row.purchaseOrder.number,
    managerName: row.purchaseOrder.mission.manager.name,
    currency: row.contract.currency,
    signatureHash: file ? sha256(file.toString("base64")) : null,
    validatedByName: row.validatedBy?.name ?? null,
  };
}

async function toDocument(row: Row, tx: Prisma.TransactionClient = db): Promise<TimesheetDocument> {
  const year = row.month.getUTCFullYear();
  const month1 = row.month.getUTCMonth() + 1;
  const days = row.days.map(toEditableDay);
  const frozen = FROZEN.includes(row.status);
  const signatureKey = frozen ? row.signatureKey : (row.freelancer.signature?.fileKey ?? null);
  const snapshot = (frozen ? asSnapshot(row.snapshot) : null) ?? (await liveSnapshot(row, signatureKey));

  const rates: Rates =
    frozen && row.dailyRateCents != null
      ? {
          dailyRateCents: row.dailyRateCents,
          overtimeHourlyRateCents: row.overtimeHourlyRateCents ?? 0,
          onCallRateCents: row.onCallRateCents ?? 0,
        }
      : {
          dailyRateCents: row.contract.dailyRateCents,
          overtimeHourlyRateCents: row.contract.overtimeHourlyRateCents,
          onCallRateCents: row.contract.onCallRateCents,
        };
  // Soumis/validé : totaux persistés à la soumission (une évolution des règles de calcul ne change
  // pas un document émis). Brouillon : recalcul depuis la saisie.
  const totals: Totals = frozen
    ? {
        workHalfDays: row.totalWorkHalfDays,
        absenceHalfDays: row.totalAbsenceHalfDays,
        overtimeHours: row.totalOvertimeHours,
        onCall: row.totalOnCall,
        amountCents: row.totalAmountCents,
      }
    : computeTotals(days, rates);
  const holidays = await holidaysFor(row.purchaseOrder.mission.country, year, month1, tx);

  return {
    ...snapshot,
    id: row.id,
    status: row.status,
    year,
    month1,
    rates,
    totals,
    days,
    holidays: new Map(holidays.map((h) => [h.date, h.label])),
    submittedAt: frozen ? row.submittedAt : null,
    validatedAt: row.validatedAt,
    authCode: frozen ? row.authCode : null,
    signatureKey,
  };
}

/** Document d'un CRA accessible à l'utilisateur, sinon null. */
export async function loadDocument(user: CurrentUser, id: string): Promise<TimesheetDocument | null> {
  const row = await db.timesheet.findFirst({ where: { id, ...documentScope(user) }, select: DOCUMENT_SELECT });
  return row ? toDocument(row) : null;
}

/** Documents de tous les CRA soumis/validés d'un mois (export Admin / Finance). */
export async function loadMonthDocuments(user: CurrentUser, year: number, month1: number): Promise<TimesheetDocument[]> {
  const rows = await db.timesheet.findMany({
    where: { ...documentScope(user), month: new Date(Date.UTC(year, month1 - 1, 1)), status: { in: FROZEN } },
    orderBy: [{ purchaseOrder: { mission: { name: "asc" } } }, { freelancer: { user: { name: "asc" } } }],
    select: DOCUMENT_SELECT,
  });
  return Promise.all(rows.map((r) => toDocument(r)));
}

/**
 * Contenu couvert par l'empreinte : tout ce qui figure sur le document, sauf le statut
 * (couvert séparément par le HMAC). Construit à partir de valeurs figées uniquement.
 */
export function canonicalContent(doc: TimesheetDocument): string {
  return JSON.stringify({
    id: doc.id,
    period: [doc.year, doc.month1],
    freelancer: doc.freelancerName,
    company: doc.company,
    mission: doc.missionName,
    po: doc.poNumber,
    currency: doc.currency,
    rates: [doc.rates.dailyRateCents, doc.rates.overtimeHourlyRateCents, doc.rates.onCallRateCents],
    totals: [
      doc.totals.workHalfDays,
      doc.totals.absenceHalfDays,
      doc.totals.overtimeHours,
      doc.totals.onCall,
      doc.totals.amountCents,
    ],
    days: doc.days.map((d) => [d.date, d.workHalfDays, d.absenceHalfDays, d.half, d.overtimeHours, d.onCall, d.exceptionReason]),
    signature: [doc.signatureKey, doc.signatureHash],
    validated: doc.status === "VALIDATED" ? [doc.validatedAt?.toISOString() ?? null, doc.validatedByName ?? null] : null,
  });
}

export function expectedAuthCode(doc: TimesheetDocument): { code: string; contentHash: string } {
  const contentHash = sha256(canonicalContent(doc));
  const code = computeAuthCode(
    { id: doc.id, status: doc.status, contentHash, poNumber: doc.poNumber, year: doc.year, month1: doc.month1 },
    authCodeSecret(),
  );
  return { code, contentHash };
}

/**
 * Fige le contenu (si besoin) et enregistre le code d'un CRA soumis ou validé.
 * La ligne est verrouillée (FOR UPDATE) : un scellement concurrent d'une validation ne peut pas
 * écrire le code d'un statut périmé. `onlyIfUnsealed` : scellement à la volée des CRA antérieurs.
 */
export async function sealTimesheet(tx: Prisma.TransactionClient, id: string, opts: { onlyIfUnsealed?: boolean } = {}) {
  await tx.$queryRaw`SELECT id FROM "Timesheet" WHERE id = ${id} FOR UPDATE`;
  const row = await tx.timesheet.findUniqueOrThrow({ where: { id }, select: DOCUMENT_SELECT });
  if (!FROZEN.includes(row.status)) return null;
  if (opts.onlyIfUnsealed && row.authCode) return row.authCode;

  // Figeage : à la soumission (pas encore d'instantané) ; à la validation, ajout du validateur.
  const base = asSnapshot(row.snapshot) ?? (await liveSnapshot(row, row.signatureKey));
  const snapshot: DocumentSnapshot = {
    ...base,
    validatedByName: row.status === "VALIDATED" ? (row.validatedBy?.name ?? null) : null,
  };
  const doc = await toDocument({ ...row, snapshot: snapshot as unknown as Prisma.JsonValue }, tx);
  const { code, contentHash } = expectedAuthCode(doc);
  await tx.timesheet.update({
    where: { id },
    data: {
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      authCode: code,
      contentHash,
      ...(row.status === "SUBMITTED" ? { submittedCode: code } : {}),
    },
  });
  return code;
}

/** Vérification publique d'un code : recalcul depuis la base, sans faire confiance au code stocké. */
export async function verifyAuthCode(code: string) {
  const row = await db.timesheet.findUnique({ where: { authCode: code }, select: DOCUMENT_SELECT });
  if (row && FROZEN.includes(row.status)) {
    const doc = await toDocument(row);
    return { kind: "current" as const, doc, intact: expectedAuthCode(doc).code === code };
  }
  // PDF provisoire d'un CRA validé depuis : version remplacée, pas un faux.
  const superseded = await db.timesheet.findUnique({ where: { submittedCode: code }, select: DOCUMENT_SELECT });
  if (superseded?.status === "VALIDATED") return { kind: "superseded" as const, doc: await toDocument(superseded), intact: true };
  return null;
}
