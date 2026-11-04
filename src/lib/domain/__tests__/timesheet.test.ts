import { describe, expect, it } from "vitest";
import { isWeekend, monthDates } from "../calendar";
import { computeTotals, formatDays, formatEur, validateDay, type DayEntry } from "../timesheet";

const RATES = { dailyRateCents: 62_000, overtimeHourlyRateCents: 9_500, onCallRateCents: 15_000 };
const day = (date: string, p: Partial<DayEntry> = {}): DayEntry => ({
  date,
  workHalfDays: 2,
  absenceHalfDays: 0,
  overtimeHours: 0,
  onCall: false,
  ...p,
});

/** Jeu de données de la maquette : juillet 2026, Camille Rey, férié le 14 */
function prototypeJuly(): DayEntry[] {
  return monthDates(2026, 7)
    .filter((d) => !isWeekend(d))
    .map((d) => {
      const n = Number(d.slice(8));
      if (n === 14) return day(d, { workHalfDays: 0 });
      if (n >= 27) return day(d, { workHalfDays: 0, absenceHalfDays: 2 });
      return day(d, {
        workHalfDays: n === 8 ? 1 : 2,
        overtimeHours: n === 9 ? 2 : n === 23 ? 3 : 0,
        onCall: n === 3 || n === 17,
      });
    });
}

describe("computeTotals", () => {
  it("reproduit le montant de la maquette : 16,5 j, 5 h, 2 astreintes = 11 005 €", () => {
    const t = computeTotals(prototypeJuly(), RATES);
    expect(formatDays(t.workHalfDays)).toBe("16,5");
    expect(t.overtimeHours).toBe(5);
    expect(t.onCall).toBe(2);
    expect(t.amountCents).toBe(1_100_500);
    expect(formatEur(t.amountCents)).toMatch(/^11\s005\s€$/);
  });

  it("régression prototype : HS et astreinte restées sur un jour passé en absence ne sont pas facturées", () => {
    const t = computeTotals([day("2026-07-27", { workHalfDays: 0, absenceHalfDays: 2, overtimeHours: 3, onCall: true })], RATES);
    expect(t.amountCents).toBe(0);
  });

  it("journée mixte 0,5 travaillé + 0,5 congé", () => {
    const t = computeTotals([day("2026-07-08", { workHalfDays: 1, absenceHalfDays: 1 })], RATES);
    expect(t).toMatchObject({ workHalfDays: 1, absenceHalfDays: 1, amountCents: 31_000 });
  });

  it("TJM impair : arrondi au centime sur le total, pas par demi-journée", () => {
    const t = computeTotals([day("2026-07-01", { workHalfDays: 1 }), day("2026-07-02", { workHalfDays: 1 })], {
      ...RATES,
      dailyRateCents: 62_001,
    });
    expect(t.amountCents).toBe(62_001);
  });
});

describe("validateDay", () => {
  const open = { isWeekend: false, isHoliday: false };

  it("journée standard valide", () => {
    expect(validateDay(day("2026-07-01"), open)).toEqual([]);
  });

  it("refuse plus de 2 demi-journées et les HS hors bornes", () => {
    expect(validateDay(day("2026-07-01", { absenceHalfDays: 1 }), open)).toContain("HALF_DAYS_EXCEED_DAY");
    expect(validateDay(day("2026-07-01", { overtimeHours: 7 }), open)).toContain("OVERTIME_RANGE");
  });

  it("refuse les HS sans travail et l'astreinte pendant une absence complète", () => {
    const d = day("2026-07-27", { workHalfDays: 0, absenceHalfDays: 2, overtimeHours: 2, onCall: true });
    expect(validateDay(d, open)).toEqual(expect.arrayContaining(["OVERTIME_WITHOUT_WORK", "ON_CALL_DURING_FULL_ABSENCE"]));
  });

  it("saisie sur week-end / férié : motif obligatoire", () => {
    expect(validateDay(day("2026-07-04"), { isWeekend: true, isHoliday: false })).toContain("NON_WORKING_DAY_NEEDS_REASON");
    expect(
      validateDay(day("2026-07-04", { exceptionReason: "Mise en production" }), { isWeekend: true, isHoliday: false }),
    ).toEqual([]);
  });

  it("astreinte seule le week-end : autorisée", () => {
    expect(validateDay(day("2026-07-04", { workHalfDays: 0, onCall: true }), { isWeekend: true, isHoliday: false })).toEqual([]);
  });
});
