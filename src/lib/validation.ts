import { z } from "zod";

/**
 * Date calendaire stricte AAAA-MM-JJ : refuse les dates inexistantes (2026-02-31 serait sinon
 * convertie silencieusement en 3 mars, 2026-13-01 provoquerait une erreur serveur).
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const calendarDate = z.string().refine(isCalendarDate, "Date invalide");
