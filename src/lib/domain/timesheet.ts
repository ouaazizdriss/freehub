/**
 * Règles de calcul du CRA — module pur, partagé :
 * - dans le navigateur pour l'aperçu instantané (montant estimé) ;
 * - côté serveur comme source de vérité (totaux persistés, PDF, export).
 *
 * Unités : demi-journées (Int) et centimes (Int). Aucun flottant pour l'argent.
 */

import type { IsoDate } from "./calendar";

export const MAX_OVERTIME_HOURS_PER_DAY = 6;

export type DayEntry = {
  date: IsoDate;
  /** 0, 1 (demi-journée) ou 2 (journée) */
  workHalfDays: number;
  absenceHalfDays: number;
  overtimeHours: number;
  onCall: boolean;
  exceptionReason?: string | null;
};

export type Rates = {
  dailyRateCents: number;
  overtimeHourlyRateCents: number;
  onCallRateCents: number;
};

export type Totals = {
  workHalfDays: number;
  absenceHalfDays: number;
  overtimeHours: number;
  onCall: number;
  amountCents: number;
};

export type DayIssueCode =
  | "HALF_DAYS_RANGE"
  | "HALF_DAYS_EXCEED_DAY"
  | "OVERTIME_RANGE"
  | "OVERTIME_WITHOUT_WORK"
  | "ON_CALL_DURING_FULL_ABSENCE"
  | "NON_WORKING_DAY_NEEDS_REASON";

export type DayContext = { isWeekend: boolean; isHoliday: boolean };

/** Contrôles de cohérence d'une journée. Une liste vide = journée valide. */
export function validateDay(day: DayEntry, ctx: DayContext): DayIssueCode[] {
  const issues: DayIssueCode[] = [];
  const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n <= 2;

  if (!inRange(day.workHalfDays) || !inRange(day.absenceHalfDays)) issues.push("HALF_DAYS_RANGE");
  if (day.workHalfDays + day.absenceHalfDays > 2) issues.push("HALF_DAYS_EXCEED_DAY");
  if (!Number.isInteger(day.overtimeHours) || day.overtimeHours < 0 || day.overtimeHours > MAX_OVERTIME_HOURS_PER_DAY) {
    issues.push("OVERTIME_RANGE");
  }
  if (day.overtimeHours > 0 && day.workHalfDays === 0) issues.push("OVERTIME_WITHOUT_WORK");
  if (day.onCall && day.absenceHalfDays === 2) issues.push("ON_CALL_DURING_FULL_ABSENCE");
  if ((ctx.isWeekend || ctx.isHoliday) && day.workHalfDays > 0 && !day.exceptionReason?.trim()) {
    issues.push("NON_WORKING_DAY_NEEDS_REASON");
  }
  return issues;
}

/**
 * Totaux et valorisation HT :
 *   montant = jours × TJM + heures_sup × taux HS + astreintes × taux astreinte
 *
 * Correctif vs prototype : les heures sup. ne comptent que sur une journée travaillée,
 * et une astreinte n'est pas valorisée pendant une absence d'une journée entière
 * (le prototype facturait les HS / astreintes restées sur un jour passé en « Congé »).
 */
export function computeTotals(days: readonly DayEntry[], rates: Rates): Totals {
  let workHalfDays = 0;
  let absenceHalfDays = 0;
  let overtimeHours = 0;
  let onCall = 0;

  for (const d of days) {
    workHalfDays += d.workHalfDays;
    absenceHalfDays += d.absenceHalfDays;
    if (d.workHalfDays > 0) overtimeHours += d.overtimeHours;
    if (d.onCall && d.absenceHalfDays < 2) onCall += 1;
  }

  const amountCents =
    Math.round((workHalfDays * rates.dailyRateCents) / 2) +
    overtimeHours * rates.overtimeHourlyRateCents +
    onCall * rates.onCallRateCents;

  return { workHalfDays, absenceHalfDays, overtimeHours, onCall, amountCents };
}

// ---------- Formatage (fr-FR) ----------

/** 33 demi-journées → "16,5" */
export function formatDays(halfDays: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(halfDays / 2);
}

/** 1100500 → "11 005 €" (centimes masqués quand ils sont nuls) */
export function formatEur(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
