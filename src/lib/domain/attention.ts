/**
 * Points d'attention d'un CRA soumis, pour le manager — module pur.
 * Ils aident à décider ; ils ne bloquent pas la validation (les contrôles bloquants
 * ont déjà été appliqués à la soumission, cf. cra-editor.ts).
 */
import { isWeekend, monthDates, type IsoDate } from "./calendar";
import { inPeriod, type EditableDay, type Period } from "./cra-editor";
import { computeTotals } from "./timesheet";

export type AttentionLevel = "ok" | "info" | "warning";

export type AttentionPoint = { level: AttentionLevel; code: AttentionCode; text: string; dates?: IsoDate[] };

export type AttentionCode =
  | "NON_WORKING_DAYS_WORKED"
  | "OVERTIME_HIGH"
  | "ON_CALL"
  | "COMMENTS"
  | "UNFILLED_DAYS"
  | "PO_TIGHT"
  | "PO_EXCEEDED"
  | "PO_OK"
  | "AMOUNT_VARIATION"
  | "MONTH_NOT_OVER";

/** Seuils (revus avec la direction des achats si besoin) */
export const ATTENTION_THRESHOLDS = {
  /** Heures sup. mensuelles au-delà desquelles on alerte */
  overtimeHoursPerMonth: 6,
  /** Part du PO consommée après validation au-delà de laquelle le PO est « tendu » */
  poTightRatio: 0.85,
  /** Variation du montant vs le mois précédent signalée au-delà de ce ratio */
  amountVariationRatio: 0.25,
} as const;

export type AttentionInput = {
  year: number;
  month1: number;
  days: readonly EditableDay[];
  holidays: ReadonlySet<IsoDate>;
  /** Périodes couvertes par le contrat et le PO (jours hors période : non attendus) */
  periods: readonly Period[];
  /** Date de soumission (jour, fuseau métier) : un mois soumis avant sa fin est signalé */
  submittedOn: IsoDate | null;
  /** Demi-journées du PO déjà consommées par les autres CRA soumis/validés */
  poConsumedOthersHalfDays: number;
  poBudgetHalfDays: number;
  previousAmountCents: number | null;
  amountCents: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

export function attentionPoints(input: AttentionInput): AttentionPoint[] {
  const points: AttentionPoint[] = [];
  const t = ATTENTION_THRESHOLDS;
  const totals = computeTotals(input.days, { dailyRateCents: 0, overtimeHourlyRateCents: 0, onCallRateCents: 0 });

  const nonWorking = input.days.filter((d) => d.workHalfDays > 0 && (isWeekend(d.date) || input.holidays.has(d.date)));
  if (nonWorking.length > 0) {
    points.push({
      level: "warning",
      code: "NON_WORKING_DAYS_WORKED",
      text: `${plural(nonWorking.length, "jour")} travaillé${nonWorking.length > 1 ? "s" : ""} un week-end ou un férié (motif saisi).`,
      dates: nonWorking.map((d) => d.date),
    });
  }
  if (totals.overtimeHours > t.overtimeHoursPerMonth) {
    points.push({
      level: "warning",
      code: "OVERTIME_HIGH",
      text: `${totals.overtimeHours} h sup. dans le mois (seuil ${t.overtimeHoursPerMonth} h).`,
      dates: input.days.filter((d) => d.overtimeHours > 0 && d.workHalfDays > 0).map((d) => d.date),
    });
  }
  if (totals.onCall > 0) {
    points.push({
      level: "info",
      code: "ON_CALL",
      text: `${plural(totals.onCall, "astreinte")} déclarée${totals.onCall > 1 ? "s" : ""}.`,
      dates: input.days.filter((d) => d.onCall && d.absenceHalfDays < 2).map((d) => d.date),
    });
  }
  const commented = input.days.filter((d) => d.comment?.trim());
  if (commented.length > 0) {
    points.push({
      level: "info",
      code: "COMMENTS",
      text: `${plural(commented.length, "commentaire")} du freelance.`,
      dates: commented.map((d) => d.date),
    });
  }

  const filled = new Set(input.days.filter((d) => d.workHalfDays + d.absenceHalfDays > 0).map((d) => d.date));
  const monthDays = monthDates(input.year, input.month1);
  const lastDay = monthDays[monthDays.length - 1];
  // Jours attendus : ouvrés, dans la période du contrat et déjà écoulés à la soumission.
  const horizon = input.submittedOn && input.submittedOn < lastDay ? input.submittedOn : lastDay;
  const unfilled = monthDays.filter(
    (d) => !isWeekend(d) && !input.holidays.has(d) && inPeriod(d, input.periods) && d <= horizon && !filled.has(d),
  );
  if (input.submittedOn && input.submittedOn < lastDay) {
    points.push({
      level: "warning",
      code: "MONTH_NOT_OVER",
      text: "CRA soumis avant la fin du mois : la validation verrouillera aussi les jours restants.",
    });
  }
  if (unfilled.length > 0) {
    points.push({
      level: "info",
      code: "UNFILLED_DAYS",
      text: `${plural(unfilled.length, "jour ouvré")} sans saisie (non travaillé${unfilled.length > 1 ? "s" : ""}).`,
      dates: unfilled,
    });
  }

  const after = input.poConsumedOthersHalfDays + totals.workHalfDays;
  const ratio = input.poBudgetHalfDays > 0 ? after / input.poBudgetHalfDays : 1;
  const pct = Math.round(ratio * 100);
  if (after > input.poBudgetHalfDays) {
    points.push({ level: "warning", code: "PO_EXCEEDED", text: `Le bon de commande serait dépassé (${pct} % du budget).` });
  } else if (ratio >= t.poTightRatio) {
    points.push({ level: "warning", code: "PO_TIGHT", text: `Bon de commande tendu : ${pct} % consommé après validation.` });
  } else {
    points.push({ level: "ok", code: "PO_OK", text: `Contrôle PO OK : ${pct} % consommé après validation.` });
  }

  if (input.previousAmountCents && input.previousAmountCents > 0) {
    const variation = (input.amountCents - input.previousAmountCents) / input.previousAmountCents;
    if (Math.abs(variation) > t.amountVariationRatio) {
      points.push({
        level: "info",
        code: "AMOUNT_VARIATION",
        text: `Montant ${variation > 0 ? "en hausse" : "en baisse"} de ${Math.round(Math.abs(variation) * 100)} % par rapport au mois précédent.`,
      });
    }
  }
  return points;
}

/** Un CRA est « sans réserve » s'il ne remonte aucun avertissement : seul cas autorisé pour « Tout valider ». */
export function isClean(points: readonly AttentionPoint[]): boolean {
  return points.every((p) => p.level !== "warning");
}

export const MIN_REJECTION_REASON = 10;
export const MAX_REJECTION_REASON = 1000;
