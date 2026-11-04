/**
 * Absences et capacité — module pur.
 * Une absence est une plage de dates (bornes incluses) ; seuls les jours ouvrés (hors week-end et
 * fériés du pays de la mission) pèsent sur la capacité et sur le CRA.
 */
import { daysInMonth, isoDate, isWeekend, monthDates, type IsoDate } from "./calendar";

export type AbsenceKind = "LEAVE" | "UNAVAILABLE" | "SICK";

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  LEAVE: "Congé",
  UNAVAILABLE: "Indisponibilité",
  SICK: "Arrêt maladie",
};

export type Range = { start: IsoDate; end: IsoDate };

/** Durée maximale d'une déclaration (au-delà : fin de mission, à traiter par l'admin) */
export const MAX_ABSENCE_DAYS = 120;

export function overlaps(a: Range, b: Range): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Jours ouvrés d'une absence compris dans un mois. */
export function absenceWorkingDays(range: Range, year: number, month1: number, holidays: ReadonlySet<IsoDate>): IsoDate[] {
  return monthDates(year, month1).filter((d) => d >= range.start && d <= range.end && !isWeekend(d) && !holidays.has(d));
}

/** Position d'une absence dans la piste du mois (Gantt), en pourcentage. Null si hors du mois. */
export function ganttBar(range: Range, year: number, month1: number): { left: number; width: number } | null {
  const first = isoDate(year, month1, 1);
  const last = isoDate(year, month1, daysInMonth(year, month1));
  if (range.end < first || range.start > last) return null;
  const total = daysInMonth(year, month1);
  const start = range.start < first ? 1 : Number(range.start.slice(8));
  const end = range.end > last ? total : Number(range.end.slice(8));
  return { left: ((start - 1) / total) * 100, width: ((end - start + 1) / total) * 100 };
}

export type CapacityInput = {
  year: number;
  month1: number;
  holidays: ReadonlySet<IsoDate>;
  missions: {
    id: string;
    name: string;
    /**
     * Freelances affectés sur le mois : `periods` = jours où leur contrat les rattache à la mission
     * (capacité et absences ne comptent que sur ces jours).
     */
    members: { freelancerId: string; name: string; periods: Range[]; absences: Range[] }[];
  }[];
};

export type MissionCapacity = {
  id: string;
  name: string;
  capacityDays: number;
  absentDays: number;
  ratio: number;
  /** Jours où au moins deux freelances de la mission sont absents ensemble */
  overlaps: { date: IsoDate; names: string[] }[];
};

/** Impact capacitaire par mission : jours ouvrés perdus / capacité théorique, et absences simultanées. */
export function missionCapacity(input: CapacityInput): MissionCapacity[] {
  const working = monthDates(input.year, input.month1).filter((d) => !isWeekend(d) && !input.holidays.has(d));
  return input.missions.map((m) => {
    const absentByDay = new Map<IsoDate, string[]>();
    let absentDays = 0;
    let capacityDays = 0;
    for (const member of m.members) {
      const onMission = (d: IsoDate) => member.periods.some((p) => d >= p.start && d <= p.end);
      capacityDays += working.filter(onMission).length;
      const days = new Set(
        member.absences.flatMap((r) => absenceWorkingDays(r, input.year, input.month1, input.holidays)).filter(onMission),
      );
      absentDays += days.size;
      for (const d of days) absentByDay.set(d, [...(absentByDay.get(d) ?? []), member.name]);
    }
    return {
      id: m.id,
      name: m.name,
      capacityDays,
      absentDays,
      ratio: capacityDays > 0 ? absentDays / capacityDays : 0,
      overlaps: [...absentByDay.entries()]
        .filter(([, names]) => names.length > 1)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, names]) => ({ date, names })),
    };
  });
}
