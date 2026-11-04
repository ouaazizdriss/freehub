/**
 * Calendrier — fonctions pures, sans dépendance serveur (utilisables dans le navigateur et sur le serveur).
 * Les dates calendaires sont des chaînes ISO "YYYY-MM-DD" : pas d'heure, pas de fuseau,
 * donc pas de décalage d'un jour selon le TZ du navigateur ou du serveur.
 */

export type IsoDate = string;

const pad = (n: number) => String(n).padStart(2, "0");

/** month1 : 1 = janvier … 12 = décembre */
export function isoDate(year: number, month1: number, day: number): IsoDate {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

export function parseIso(date: IsoDate): { year: number; month1: number; day: number } {
  const [year, month1, day] = date.split("-").map(Number);
  return { year, month1, day };
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** 0 = lundi … 6 = dimanche (semaine ISO) */
export function weekdayMon0(date: IsoDate): number {
  const { year, month1, day } = parseIso(date);
  return (new Date(Date.UTC(year, month1 - 1, day)).getUTCDay() + 6) % 7;
}

export function isWeekend(date: IsoDate): boolean {
  return weekdayMon0(date) >= 5;
}

export function monthDates(year: number, month1: number): IsoDate[] {
  return Array.from({ length: daysInMonth(year, month1) }, (_, i) => isoDate(year, month1, i + 1));
}

/**
 * Disposition de la grille mensuelle (lundi en première colonne).
 * Le prototype codait 2 cases vides en dur (juillet 2026) : ici le décalage est calculé,
 * et un mois commençant un dimanche occupe 6 lignes.
 */
export function monthGrid(year: number, month1: number): { leadingBlanks: number; rows: number; dates: IsoDate[] } {
  const dates = monthDates(year, month1);
  const leadingBlanks = weekdayMon0(dates[0]);
  return { leadingBlanks, rows: Math.ceil((leadingBlanks + dates.length) / 7), dates };
}

/** Jours ouvrés : hors week-end et hors fériés du pays de la mission. */
export function workingDays(year: number, month1: number, holidays: ReadonlySet<IsoDate>): IsoDate[] {
  return monthDates(year, month1).filter((d) => !isWeekend(d) && !holidays.has(d));
}

/** Date limite de dépôt : le N du mois suivant (5 par défaut, cf. maquette « Clôture le 5 août »). */
export function closingDeadline(year: number, month1: number, closingDay = 5): IsoDate {
  return month1 === 12 ? isoDate(year + 1, 1, closingDay) : isoDate(year, month1 + 1, closingDay);
}

/** Le mois suivant/précédent, année comprise (le prototype bouclait sur 12 mois sans changer d'année). */
export function shiftMonth(year: number, month1: number, delta: number): { year: number; month1: number } {
  const index = year * 12 + (month1 - 1) + delta;
  return { year: Math.floor(index / 12), month1: (index % 12) + 1 };
}

/**
 * Période de clôture en cours à une date donnée : jusqu'au jour de clôture inclus,
 * on clôture encore le mois précédent ; ensuite, le mois en cours.
 */
export function closingPeriod(today: IsoDate, closingDay = 5): { year: number; month1: number; deadline: IsoDate } {
  const { year, month1, day } = parseIso(today);
  const period = day <= closingDay ? shiftMonth(year, month1, -1) : { year, month1 };
  return { ...period, deadline: closingDeadline(period.year, period.month1, closingDay) };
}

/** Date du jour dans le fuseau métier (Casablanca par défaut), au format ISO. */
export function todayIso(timeZone = "Africa/Casablanca", now = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function formatMonth(year: number, month1: number): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    Date.UTC(year, month1 - 1, 1),
  );
}

export function formatLongDate(date: IsoDate): string {
  const { year, month1, day } = parseIso(date);
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    Date.UTC(year, month1 - 1, day),
  );
}

export const BUSINESS_TIME_ZONE = "Africa/Casablanca";

/**
 * Date et heure dans le fuseau métier. À appeler côté serveur uniquement et à transmettre
 * en texte au navigateur : les bases de fuseaux (tzdata) de Node et du navigateur peuvent
 * différer (cas du Maroc), ce qui casserait l'hydratation.
 */
export function formatDateTime(date: Date | string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: style, timeStyle: "short", timeZone: BUSINESS_TIME_ZONE }).format(new Date(date));
}
