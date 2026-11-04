import { describe, expect, it } from "vitest";
import {
  closingDeadline,
  closingPeriod,
  formatMonth,
  todayIso,
  monthGrid,
  shiftMonth,
  weekdayMon0,
  workingDays,
} from "../calendar";

describe("calendar", () => {
  it("1er juillet 2026 est un mercredi → 2 cases vides (comme la maquette)", () => {
    expect(weekdayMon0("2026-07-01")).toBe(2);
    expect(monthGrid(2026, 7)).toMatchObject({ leadingBlanks: 2, rows: 5 });
  });

  it("un mois commençant un dimanche occupe 6 lignes (mars 2026)", () => {
    expect(monthGrid(2026, 3)).toMatchObject({ leadingBlanks: 6, rows: 6 });
  });

  it("jours ouvrés : 22 en juillet 2026 avec la Fête du Trône (MA, 30/07)", () => {
    expect(workingDays(2026, 7, new Set(["2026-07-30"]))).toHaveLength(22);
    expect(workingDays(2026, 7, new Set())).toHaveLength(23);
  });

  it("février bissextile", () => {
    expect(monthGrid(2028, 2).dates).toHaveLength(29);
  });

  it("navigation de mois avec changement d'année", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month1: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month1: 12 });
  });

  it("clôture le 5 du mois suivant", () => {
    expect(closingDeadline(2026, 7)).toBe("2026-08-05");
    expect(closingDeadline(2026, 12)).toBe("2027-01-05");
  });

  it("période de clôture : le 2 novembre on clôture encore octobre", () => {
    expect(closingPeriod("2026-11-02")).toEqual({ year: 2026, month1: 10, deadline: "2026-11-05" });
    expect(closingPeriod("2026-11-06")).toEqual({ year: 2026, month1: 11, deadline: "2026-12-05" });
    expect(closingPeriod("2027-01-03")).toEqual({ year: 2026, month1: 12, deadline: "2027-01-05" });
  });

  it("date du jour dans le fuseau de Casablanca et libellé de mois", () => {
    expect(todayIso("Africa/Casablanca", new Date("2026-07-31T23:30:00Z"))).toBe("2026-08-01");
    expect(formatMonth(2026, 7)).toBe("juillet 2026");
  });
});
