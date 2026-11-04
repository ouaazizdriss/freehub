/**
 * Règles d'édition et de soumission du CRA — module pur, partagé navigateur / serveur.
 * Le navigateur s'en sert pour l'aperçu et les messages ; le serveur le rejoue sur les
 * données en base avant toute écriture (il ne fait jamais confiance au client).
 */
import { isWeekend, monthDates, weekdayMon0, type IsoDate } from "./calendar";
import { computeTotals, validateDay, type DayEntry, type DayIssueCode } from "./timesheet";

export type Half = "AM" | "PM";

/** Journée telle qu'éditée et persistée. Une journée absente de la liste = non travaillée. */
export type EditableDay = DayEntry & {
  half: Half | null;
  comment: string | null;
  exceptionReason: string | null;
};

export type DayKind = "work" | "half" | "absence" | "off";

export const DAY_KIND_LABELS: Record<DayKind, string> = {
  work: "1 journée",
  half: "Demi-journée",
  absence: "Absence",
  off: "Non travaillé",
};

export const MAX_COMMENT_LENGTH = 500;

export function emptyDay(date: IsoDate): EditableDay {
  return {
    date,
    workHalfDays: 0,
    absenceHalfDays: 0,
    half: null,
    overtimeHours: 0,
    onCall: false,
    comment: null,
    exceptionReason: null,
  };
}

export function kindOf(day: Pick<DayEntry, "workHalfDays" | "absenceHalfDays">): DayKind {
  if (day.workHalfDays === 2) return "work";
  if (day.workHalfDays === 1) return "half";
  if (day.absenceHalfDays > 0) return "absence";
  return "off";
}

/**
 * Change le type d'une journée en remettant à zéro ce qui devient incohérent :
 * pas d'heures sup. sans travail, pas d'astreinte pendant une absence complète,
 * pas de motif de dérogation sans travail. Commentaire conservé.
 */
export function withKind(day: EditableDay, kind: DayKind): EditableDay {
  switch (kind) {
    case "work":
      return { ...day, workHalfDays: 2, absenceHalfDays: 0, half: null };
    case "half":
      return {
        ...day,
        workHalfDays: 1,
        absenceHalfDays: day.workHalfDays === 1 ? day.absenceHalfDays : 0,
        half: day.half ?? "AM",
      };
    case "absence":
      return { ...day, workHalfDays: 0, absenceHalfDays: 2, half: null, overtimeHours: 0, onCall: false, exceptionReason: null };
    case "off":
      return { ...day, workHalfDays: 0, absenceHalfDays: 0, half: null, overtimeHours: 0, exceptionReason: null };
  }
}

/** Une journée sans aucune information n'a pas besoin d'être stockée. */
export function isBlank(day: EditableDay): boolean {
  return (
    day.workHalfDays === 0 &&
    day.absenceHalfDays === 0 &&
    day.overtimeHours === 0 &&
    !day.onCall &&
    !day.comment?.trim() &&
    !day.exceptionReason?.trim()
  );
}

/**
 * Périodes saisissables d'un mois : dates couvertes à la fois par un contrat et par le bon de commande.
 * Plusieurs périodes quand deux contrats successifs (ou non contigus) portent sur le même PO.
 */
export type Period = { start: IsoDate; end: IsoDate };

export function inPeriod(date: IsoDate, periods: readonly Period[]): boolean {
  return periods.some((p) => date >= p.start && date <= p.end);
}

/**
 * « Appliquer à toute la semaine » : jours ouvrés (lun–ven) de la semaine ISO du jour donné,
 * dans le mois et la période du contrat, hors jours fériés.
 */
export function weekTargets(
  date: IsoDate,
  monthDays: readonly IsoDate[],
  holidays: ReadonlySet<IsoDate>,
  periods: readonly Period[],
) {
  const index = monthDays.indexOf(date);
  if (index < 0) return [];
  const monday = index - weekdayMon0(date);
  const targets: IsoDate[] = [];
  for (let i = monday; i < monday + 5; i++) {
    const d = monthDays[i];
    if (d && !holidays.has(d) && inPeriod(d, periods)) targets.push(d);
  }
  return targets;
}

export function applyKindToDates(
  days: ReadonlyMap<IsoDate, EditableDay>,
  dates: readonly IsoDate[],
  source: EditableDay,
): Map<IsoDate, EditableDay> {
  const next = new Map(days);
  const kind = kindOf(source);
  for (const d of dates) {
    const base = withKind(next.get(d) ?? emptyDay(d), kind);
    next.set(d, { ...base, half: source.half, absenceHalfDays: source.absenceHalfDays });
  }
  return next;
}

// ---------- Contrôles de soumission ----------

export type SubmissionIssueCode =
  | DayIssueCode
  | "OUTSIDE_MONTH"
  | "OUTSIDE_CONTRACT"
  | "DUPLICATE_DATE"
  | "COMMENT_TOO_LONG"
  | "EMPTY_TIMESHEET"
  | "PO_BUDGET_EXCEEDED"
  | "FUTURE_MONTH"
  | "UNFILLED_WORKING_DAYS"
  | "MONTH_NOT_OVER"
  | "MIXED_RATES"
  | "SIGNATURE_MISSING";

export type SubmissionIssue = { code: SubmissionIssueCode; date?: IsoDate; count?: number };

export type SubmissionContext = {
  year: number;
  month1: number;
  holidays: ReadonlySet<IsoDate>;
  periods: readonly Period[];
  /** Plusieurs contrats aux taux différents dans le mois sur ce PO */
  mixedRates?: boolean;
  /** Signature déposée (obligatoire à la soumission). Non renseigné = non contrôlé (autosave). */
  hasSignature?: boolean;
  /** Demi-journées encore disponibles sur le PO (hors ce CRA) */
  poRemainingHalfDays: number;
  today: IsoDate;
};

export type SubmissionCheck = { errors: SubmissionIssue[]; warnings: SubmissionIssue[] };

/** Contrôles bloquants (erreurs) et points d'attention (avertissements) avant soumission. */
export function checkSubmission(days: readonly EditableDay[], ctx: SubmissionContext): SubmissionCheck {
  const errors: SubmissionIssue[] = [];
  const warnings: SubmissionIssue[] = [];
  const dates = monthDates(ctx.year, ctx.month1);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const seen = new Set<IsoDate>();

  if (ctx.today < first) errors.push({ code: "FUTURE_MONTH" });
  else if (ctx.today < last) warnings.push({ code: "MONTH_NOT_OVER" });

  for (const day of days) {
    if (seen.has(day.date)) errors.push({ code: "DUPLICATE_DATE", date: day.date });
    seen.add(day.date);
    if (!dates.includes(day.date)) {
      errors.push({ code: "OUTSIDE_MONTH", date: day.date });
      continue;
    }
    if (!inPeriod(day.date, ctx.periods) && !isBlank(day)) errors.push({ code: "OUTSIDE_CONTRACT", date: day.date });
    if ((day.comment?.length ?? 0) > MAX_COMMENT_LENGTH || (day.exceptionReason?.length ?? 0) > MAX_COMMENT_LENGTH) {
      errors.push({ code: "COMMENT_TOO_LONG", date: day.date });
    }
    const issues = validateDay(day, { isWeekend: isWeekend(day.date), isHoliday: ctx.holidays.has(day.date) });
    for (const code of issues) errors.push({ code, date: day.date });
  }

  const totals = computeTotals(days, { dailyRateCents: 0, overtimeHourlyRateCents: 0, onCallRateCents: 0 });
  if (totals.workHalfDays === 0) errors.push({ code: "EMPTY_TIMESHEET" });
  if (totals.workHalfDays > ctx.poRemainingHalfDays) errors.push({ code: "PO_BUDGET_EXCEEDED" });
  if (ctx.mixedRates) errors.push({ code: "MIXED_RATES" });
  if (ctx.hasSignature === false) errors.push({ code: "SIGNATURE_MISSING" });

  const filled = new Set(days.filter((d) => d.workHalfDays + d.absenceHalfDays > 0).map((d) => d.date));
  const unfilled = dates.filter(
    (d) => !isWeekend(d) && !ctx.holidays.has(d) && inPeriod(d, ctx.periods) && d <= ctx.today && !filled.has(d),
  );
  if (unfilled.length > 0) warnings.push({ code: "UNFILLED_WORKING_DAYS", count: unfilled.length, date: unfilled[0] });

  return { errors, warnings };
}

export const ISSUE_MESSAGES: Record<SubmissionIssueCode, string> = {
  HALF_DAYS_RANGE: "Nombre de demi-journées invalide.",
  HALF_DAYS_EXCEED_DAY: "Travail et absence dépassent une journée.",
  OVERTIME_RANGE: "Heures sup. hors bornes (0 à 6 h par jour).",
  OVERTIME_WITHOUT_WORK: "Heures sup. saisies sur un jour non travaillé.",
  ON_CALL_DURING_FULL_ABSENCE: "Astreinte saisie pendant une absence d'une journée.",
  NON_WORKING_DAY_NEEDS_REASON: "Travail un week-end ou un jour férié : motif de dérogation obligatoire.",
  OUTSIDE_MONTH: "Date hors du mois du CRA.",
  OUTSIDE_CONTRACT: "Saisie en dehors des dates du contrat.",
  DUPLICATE_DATE: "Date saisie deux fois.",
  COMMENT_TOO_LONG: `Commentaire trop long (${MAX_COMMENT_LENGTH} caractères max.).`,
  EMPTY_TIMESHEET: "Aucun jour travaillé : rien à soumettre.",
  PO_BUDGET_EXCEEDED: "Le total dépasse le reste à consommer du bon de commande.",
  FUTURE_MONTH: "Ce mois n'a pas commencé.",
  UNFILLED_WORKING_DAYS: "jour(s) ouvré(s) sans saisie, comptés comme non travaillés.",
  MONTH_NOT_OVER: "Le mois n'est pas terminé : vérifiez les jours restants avant de soumettre.",
  SIGNATURE_MISSING: "Déposez votre signature (panneau de droite) : elle est apposée sur le PDF à la soumission.",
  MIXED_RATES:
    "Deux contrats aux taux différents couvrent ce mois sur ce bon de commande : la soumission doit être traitée par l'administrateur.",
};

export function issueMessage(issue: SubmissionIssue): string {
  const base = ISSUE_MESSAGES[issue.code];
  return issue.count !== undefined ? `${issue.count} ${base}` : base;
}
