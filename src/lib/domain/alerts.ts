/**
 * Moteur d'alertes du référentiel et du pilotage — module pur.
 * Seuils partagés avec la validation (cf. attention.ts) pour que les écrans disent la même chose.
 */
import { parseIso, type IsoDate } from "./calendar";
import { ATTENTION_THRESHOLDS } from "./attention";

export const ALERT_THRESHOLDS = {
  /** Fin de contrat / mission signalée en deçà de ce nombre de jours */
  endingSoonDays: 30,
  /** Pièce justificative signalée en deçà de ce nombre de jours avant expiration */
  documentExpiringDays: 30,
  poTightRatio: ATTENTION_THRESHOLDS.poTightRatio,
} as const;

export const REQUIRED_DOCUMENTS = ["URSSAF", "INSURANCE", "KBIS"] as const;
export type DocumentKind = (typeof REQUIRED_DOCUMENTS)[number] | "OTHER";

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  URSSAF: "Attestation URSSAF",
  INSURANCE: "Assurance RC Pro",
  KBIS: "Extrait Kbis",
  OTHER: "Autre document",
};

/** Nombre de jours de `from` à `to` (négatif si `to` est passé). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIso(from);
  const b = parseIso(to);
  return Math.round((Date.UTC(b.year, b.month1 - 1, b.day) - Date.UTC(a.year, a.month1 - 1, a.day)) / 86_400_000);
}

// ---------- Bons de commande ----------

export type PoLevel = "ok" | "tight" | "exceeded";

export function poHealth(budgetHalfDays: number, consumedHalfDays: number): { ratio: number; level: PoLevel } {
  const ratio = budgetHalfDays > 0 ? consumedHalfDays / budgetHalfDays : consumedHalfDays > 0 ? Infinity : 0;
  const level: PoLevel = consumedHalfDays > budgetHalfDays ? "exceeded" : ratio >= ALERT_THRESHOLDS.poTightRatio ? "tight" : "ok";
  return { ratio, level };
}

// ---------- Pièces justificatives ----------

export type DocumentState = "missing" | "expired" | "expiring" | "ok";
export type DocumentInput = { kind: DocumentKind; expiresAt: IsoDate | null };

/** État de chaque pièce obligatoire (la plus récente expiration fait foi). */
export function documentStates(docs: readonly DocumentInput[], today: IsoDate): Record<(typeof REQUIRED_DOCUMENTS)[number], DocumentState> {
  const result = {} as Record<(typeof REQUIRED_DOCUMENTS)[number], DocumentState>;
  for (const kind of REQUIRED_DOCUMENTS) {
    const ofKind = docs.filter((d) => d.kind === kind);
    if (ofKind.length === 0) {
      result[kind] = "missing";
      continue;
    }
    // Sans date d'expiration (ex. Kbis récent) : valable.
    if (ofKind.some((d) => d.expiresAt === null)) {
      result[kind] = "ok";
      continue;
    }
    const latest = ofKind.map((d) => d.expiresAt!).sort().at(-1)!;
    const left = daysBetween(today, latest);
    result[kind] = left < 0 ? "expired" : left <= ALERT_THRESHOLDS.documentExpiringDays ? "expiring" : "ok";
  }
  return result;
}

export function documentsOk(states: Record<string, DocumentState>): boolean {
  return Object.values(states).every((s) => s === "ok" || s === "expiring");
}

// ---------- Statut d'un freelance (pastille du référentiel) ----------

export type FreelancerStatus = "DOCS_KO" | "ENDING" | "PO_TIGHT" | "ACTIVE" | "INACTIVE";

export const FREELANCER_STATUS_LABELS: Record<FreelancerStatus, string> = {
  DOCS_KO: "Docs KO",
  ENDING: "Fin proche",
  PO_TIGHT: "PO tendu",
  ACTIVE: "Active",
  INACTIVE: "Hors mission",
};

/** Statut le plus grave : conformité documentaire, puis fin de mission, puis budget. */
export function freelancerStatus(input: {
  contractEnd: IsoDate | null;
  poLevel: PoLevel | null;
  docs: Record<string, DocumentState>;
  today: IsoDate;
}): FreelancerStatus {
  if (!input.contractEnd || input.contractEnd < input.today) return "INACTIVE";
  if (!documentsOk(input.docs)) return "DOCS_KO";
  if (daysBetween(input.today, input.contractEnd) <= ALERT_THRESHOLDS.endingSoonDays) return "ENDING";
  if (input.poLevel && input.poLevel !== "ok") return "PO_TIGHT";
  return "ACTIVE";
}

// ---------- Alertes du tableau de bord ----------

export type AlertLevel = "danger" | "warning" | "info";
export type AlertKind = "PO_EXCEEDED" | "PO_TIGHT" | "CONTRACT_ENDING" | "DOCS_EXPIRED" | "DOCS_EXPIRING" | "CRA_LATE";
export type Alert = { level: AlertLevel; kind: AlertKind; title: string; detail: string; href?: string };

export type AlertInput = {
  today: IsoDate;
  purchaseOrders: { number: string; mission: string; budgetHalfDays: number; consumedHalfDays: number }[];
  contracts: { freelancer: string; freelancerId: string; mission: string; endDate: IsoDate }[];
  documents: { freelancer: string; freelancerId: string; states: Record<string, DocumentState> }[];
  /** CRA de la période de clôture non déposés après l'échéance */
  late: { freelancer: string; freelancerId: string; mission: string }[];
  closingLabel: string;
};

const LEVEL_ORDER: Record<AlertLevel, number> = { danger: 0, warning: 1, info: 2 };
const list = (names: string[], max = 3) => (names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} et ${names.length - max} autre(s)`);

export function buildAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = [];

  for (const po of input.purchaseOrders) {
    const { ratio, level } = poHealth(po.budgetHalfDays, po.consumedHalfDays);
    if (level === "ok") continue;
    alerts.push({
      level: level === "exceeded" ? "danger" : "warning",
      kind: level === "exceeded" ? "PO_EXCEEDED" : "PO_TIGHT",
      title: `${po.number} ${level === "exceeded" ? "dépassé" : "tendu"}`,
      detail: `${po.mission} : ${Number.isFinite(ratio) ? Math.round(ratio * 100) : "—"} % du budget consommé.`,
    });
  }

  const ending = input.contracts
    .map((c) => ({ ...c, left: daysBetween(input.today, c.endDate) }))
    .filter((c) => c.left >= 0 && c.left <= ALERT_THRESHOLDS.endingSoonDays)
    .sort((a, b) => a.left - b.left);
  for (const c of ending) {
    alerts.push({
      level: c.left <= 7 ? "danger" : "warning",
      kind: "CONTRACT_ENDING",
      title: `Fin de mission dans ${c.left} j`,
      detail: `${c.freelancer} — ${c.mission}.`,
      href: `/freelances/${c.freelancerId}`,
    });
  }

  const expired = input.documents.filter((d) => Object.values(d.states).some((s) => s === "expired" || s === "missing"));
  if (expired.length > 0) {
    alerts.push({
      level: "danger",
      kind: "DOCS_EXPIRED",
      title: `${expired.length} dossier${expired.length > 1 ? "s" : ""} documentaire${expired.length > 1 ? "s" : ""} incomplet${expired.length > 1 ? "s" : ""}`,
      detail: `Pièce manquante ou expirée : ${list(expired.map((d) => d.freelancer))}.`,
      href: "/freelances?filtre=DOCS_KO",
    });
  }
  const expiring = input.documents.filter(
    (d) => !expired.includes(d) && Object.values(d.states).some((s) => s === "expiring"),
  );
  if (expiring.length > 0) {
    alerts.push({
      level: "info",
      kind: "DOCS_EXPIRING",
      title: "Pièces bientôt expirées",
      detail: `À renouveler sous ${ALERT_THRESHOLDS.documentExpiringDays} j : ${list(expiring.map((d) => d.freelancer))}.`,
    });
  }

  if (input.late.length > 0) {
    alerts.push({
      level: "danger",
      kind: "CRA_LATE",
      title: `${input.late.length} CRA en retard`,
      detail: `${input.closingLabel} non déposé : ${list(input.late.map((l) => l.freelancer))}.`,
    });
  }

  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

// ---------- Relances ----------

export type ReminderKind = "J-3" | "LATE";

/**
 * Relance du jour pour une période de clôture : J-3 avant l'échéance (rappel au freelance),
 * puis le lendemain de l'échéance (retard). Rien les autres jours.
 */
export function reminderFor(today: IsoDate, deadline: IsoDate): ReminderKind | null {
  const left = daysBetween(today, deadline);
  if (left === 3) return "J-3";
  if (left === -1) return "LATE";
  return null;
}
