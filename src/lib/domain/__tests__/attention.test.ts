import { describe, expect, it } from "vitest";
import { attentionPoints, isClean, type AttentionInput } from "../attention";
import { emptyDay, type EditableDay } from "../cra-editor";
import { isWeekend, monthDates } from "../calendar";

const work = (date: string, patch: Partial<EditableDay> = {}): EditableDay => ({ ...emptyDay(date), workHalfDays: 2, ...patch });
const october = monthDates(2026, 10).filter((d) => !isWeekend(d)).map((d) => work(d));
const input = (patch: Partial<AttentionInput> = {}): AttentionInput => ({
  year: 2026,
  month1: 10,
  days: october,
  holidays: new Set(),
  periods: [{ start: "2026-10-01", end: "2026-10-31" }],
  submittedOn: "2026-11-01",
  poConsumedOthersHalfDays: 0,
  poBudgetHalfDays: 400,
  previousAmountCents: null,
  amountCents: 100,
  ...patch,
});
const codes = (i: AttentionInput) => attentionPoints(i).map((p) => p.code);

describe("attentionPoints", () => {
  it("mois standard : seul le contrôle PO OK", () => {
    const points = attentionPoints(input());
    expect(points).toEqual([{ level: "ok", code: "PO_OK", text: "Contrôle PO OK : 11 % consommé après validation." }]);
    expect(isClean(points)).toBe(true);
  });

  it("week-end travaillé, heures sup. élevées, astreintes, commentaires", () => {
    const days = [
      ...october.map((d, i) => (i < 2 ? { ...d, overtimeHours: 4, comment: i === 0 ? "MEP" : null } : d)),
      work("2026-10-03", { exceptionReason: "MEP", onCall: true }),
    ];
    const points = attentionPoints(input({ days }));
    expect(points.map((p) => p.code)).toEqual(["NON_WORKING_DAYS_WORKED", "OVERTIME_HIGH", "ON_CALL", "COMMENTS", "PO_OK"]);
    expect(points[0].dates).toEqual(["2026-10-03"]);
    expect(isClean(points)).toBe(false);
  });

  it("jours ouvrés non saisis, hors fériés", () => {
    const days = october.filter((d) => d.date !== "2026-10-05" && d.date !== "2026-10-06");
    const points = attentionPoints(input({ days, holidays: new Set(["2026-10-06"]) }));
    expect(points.find((p) => p.code === "UNFILLED_DAYS")?.dates).toEqual(["2026-10-05"]);
  });

  it("PO tendu puis dépassé", () => {
    expect(codes(input({ poConsumedOthersHalfDays: 300 }))).toContain("PO_TIGHT");
    expect(codes(input({ poConsumedOthersHalfDays: 390 }))).toContain("PO_EXCEEDED");
  });

  it("variation de montant > 25 %", () => {
    expect(codes(input({ previousAmountCents: 1000, amountCents: 1300 }))).toContain("AMOUNT_VARIATION");
    expect(codes(input({ previousAmountCents: 1000, amountCents: 1200 }))).not.toContain("AMOUNT_VARIATION");
  });

  it("jours hors contrat non attendus", () => {
    const days = october.filter((d) => d.date >= "2026-10-15");
    const points = attentionPoints(input({ days, periods: [{ start: "2026-10-15", end: "2026-10-31" }] }));
    expect(points.map((p) => p.code)).not.toContain("UNFILLED_DAYS");
  });

  it("soumis avant la fin du mois : avertissement, jours futurs non comptés comme manquants", () => {
    const days = october.filter((d) => d.date <= "2026-10-20");
    const points = attentionPoints(input({ days, submittedOn: "2026-10-20" }));
    expect(points.map((p) => p.code)).toEqual(["MONTH_NOT_OVER", "PO_OK"]);
    expect(isClean(points)).toBe(false);
  });
});
