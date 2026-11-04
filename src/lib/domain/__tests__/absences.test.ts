import { describe, expect, it } from "vitest";
import { absenceWorkingDays, ganttBar, missionCapacity, overlaps } from "../absences";

describe("overlaps", () => {
  it("bornes incluses", () => {
    expect(overlaps({ start: "2026-11-02", end: "2026-11-06" }, { start: "2026-11-06", end: "2026-11-10" })).toBe(true);
    expect(overlaps({ start: "2026-11-02", end: "2026-11-05" }, { start: "2026-11-06", end: "2026-11-10" })).toBe(false);
  });
});

describe("absenceWorkingDays", () => {
  it("hors week-end et fériés, limité au mois", () => {
    // 30/10 (ven) → 09/11 (lun) ; novembre : 2–6 et 9, moins le férié du 6
    const days = absenceWorkingDays({ start: "2026-10-30", end: "2026-11-09" }, 2026, 11, new Set(["2026-11-06"]));
    expect(days).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-09"]);
  });
});

describe("ganttBar", () => {
  it("position et largeur en % du mois, tronquées aux bornes", () => {
    expect(ganttBar({ start: "2026-11-01", end: "2026-11-30" }, 2026, 11)).toEqual({ left: 0, width: 100 });
    expect(ganttBar({ start: "2026-10-25", end: "2026-11-03" }, 2026, 11)).toEqual({ left: 0, width: 10 });
    expect(ganttBar({ start: "2026-12-01", end: "2026-12-03" }, 2026, 11)).toBeNull();
  });
});

describe("missionCapacity", () => {
  it("jours perdus, capacité et absences simultanées", () => {
    const [m] = missionCapacity({
      year: 2026,
      month1: 11,
      holidays: new Set(["2026-11-06", "2026-11-18"]),
      missions: [
        {
          id: "m",
          name: "Refonte CRM",
          members: [
            {
              freelancerId: "a",
              name: "Camille",
              periods: [{ start: "2026-11-01", end: "2026-11-30" }],
              absences: [{ start: "2026-11-09", end: "2026-11-13" }],
            },
            {
              freelancerId: "b",
              name: "Yanis",
              periods: [{ start: "2026-11-01", end: "2026-11-30" }],
              absences: [{ start: "2026-11-12", end: "2026-11-12" }],
            },
          ],
        },
      ],
    });
    // Novembre 2026 : 21 jours ouvrés moins 2 fériés = 19, × 2 freelances
    expect(m.capacityDays).toBe(38);
    expect(m.absentDays).toBe(6);
    expect(m.overlaps).toEqual([{ date: "2026-11-12", names: ["Camille", "Yanis"] }]);
  });

  it("contrat partiel : capacité et absences limitées aux jours sur la mission", () => {
    const [m] = missionCapacity({
      year: 2026,
      month1: 11,
      holidays: new Set(),
      missions: [
        {
          id: "m",
          name: "M",
          members: [
            // Contrat jusqu'au 10 ; congé du 20 au 24 → hors mission, ne compte pas
            {
              freelancerId: "a",
              name: "A",
              periods: [{ start: "2026-11-01", end: "2026-11-10" }],
              absences: [{ start: "2026-11-20", end: "2026-11-24" }],
            },
            {
              freelancerId: "b",
              name: "B",
              periods: [{ start: "2026-11-01", end: "2026-11-30" }],
              absences: [{ start: "2026-11-20", end: "2026-11-20" }],
            },
          ],
        },
      ],
    });
    expect(m.capacityDays).toBe(7 + 21); // 7 jours ouvrés du 2 au 10, 21 sur le mois
    expect(m.absentDays).toBe(1);
    expect(m.overlaps).toEqual([]);
  });
});
