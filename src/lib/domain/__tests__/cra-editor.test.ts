import { describe, expect, it } from "vitest";
import { monthDates } from "../calendar";
import {
  applyKindToDates,
  checkSubmission,
  emptyDay,
  isBlank,
  kindOf,
  weekTargets,
  withKind,
  type EditableDay,
  type SubmissionContext,
} from "../cra-editor";

const day = (date: string, patch: Partial<EditableDay> = {}): EditableDay => ({ ...emptyDay(date), ...patch });
const work = (date: string, patch: Partial<EditableDay> = {}) => day(date, { workHalfDays: 2, ...patch });

// Octobre 2026 : le 1er est un jeudi, le 31 un samedi.
const october = monthDates(2026, 10);
const ctx = (patch: Partial<SubmissionContext> = {}): SubmissionContext => ({
  year: 2026,
  month1: 10,
  holidays: new Set(),
  periods: [{ start: "2026-10-01", end: "2026-10-31" }],
  poRemainingHalfDays: 1000,
  today: "2026-11-03",
  ...patch,
});
const allWorkingDays = october.filter((d) => !["0", "6"].includes(String(new Date(d).getUTCDay()))).map((d) => work(d));

describe("kindOf / withKind", () => {
  it("classe les journées", () => {
    expect(kindOf(work("2026-10-01"))).toBe("work");
    expect(kindOf(day("2026-10-01", { workHalfDays: 1, absenceHalfDays: 1 }))).toBe("half");
    expect(kindOf(day("2026-10-01", { absenceHalfDays: 2 }))).toBe("absence");
    expect(kindOf(emptyDay("2026-10-01"))).toBe("off");
  });

  it("passer en absence efface heures sup., astreinte et motif mais garde le commentaire", () => {
    const d = work("2026-10-03", { overtimeHours: 3, onCall: true, exceptionReason: "MEP", comment: "note" });
    expect(withKind(d, "absence")).toMatchObject({
      absenceHalfDays: 2,
      workHalfDays: 0,
      overtimeHours: 0,
      onCall: false,
      exceptionReason: null,
      comment: "note",
    });
  });

  it("passer en non travaillé garde l'astreinte (astreinte possible sans travail)", () => {
    const d = work("2026-10-01", { overtimeHours: 2, onCall: true });
    expect(withKind(d, "off")).toMatchObject({ workHalfDays: 0, overtimeHours: 0, onCall: true });
  });

  it("demi-journée : matin par défaut, garde la demi-absence d'une demi-journée existante", () => {
    expect(withKind(work("2026-10-01"), "half")).toMatchObject({ workHalfDays: 1, absenceHalfDays: 0, half: "AM" });
    const mixed = day("2026-10-01", { workHalfDays: 1, absenceHalfDays: 1, half: "PM" });
    expect(withKind(mixed, "half")).toMatchObject({ absenceHalfDays: 1, half: "PM" });
  });

  it("isBlank", () => {
    expect(isBlank(emptyDay("2026-10-01"))).toBe(true);
    expect(isBlank(day("2026-10-01", { comment: "x" }))).toBe(false);
    expect(isBlank(day("2026-10-01", { onCall: true }))).toBe(false);
  });
});

describe("weekTargets", () => {
  const period = [{ start: "2026-10-01", end: "2026-10-31" }];

  it("jours ouvrés de la semaine ISO, limités au mois (semaine du jeudi 1er)", () => {
    expect(weekTargets("2026-10-01", october, new Set(), period)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("saute les fériés et les jours hors contrat", () => {
    const targets = weekTargets("2026-10-14", october, new Set(["2026-10-13"]), [{ start: "2026-10-01", end: "2026-10-15" }]);
    expect(targets).toEqual(["2026-10-12", "2026-10-14", "2026-10-15"]);
  });

  it("depuis un samedi : la semaine qui se termine ce week-end", () => {
    expect(weekTargets("2026-10-10", october, new Set(), period)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
  });

  it("applique le type et la répartition de la journée source", () => {
    const source = day("2026-10-05", { workHalfDays: 1, absenceHalfDays: 1, half: "PM" });
    const next = applyKindToDates(new Map([["2026-10-06", work("2026-10-06", { overtimeHours: 2 })]]), ["2026-10-06"], source);
    expect(next.get("2026-10-06")).toMatchObject({ workHalfDays: 1, absenceHalfDays: 1, half: "PM", overtimeHours: 2 });
  });
});

describe("checkSubmission", () => {
  it("un mois complet et cohérent ne remonte rien", () => {
    expect(checkSubmission(allWorkingDays, ctx())).toEqual({ errors: [], warnings: [] });
  });

  it("CRA vide bloquant", () => {
    expect(checkSubmission([], ctx()).errors).toContainEqual({ code: "EMPTY_TIMESHEET" });
  });

  it("dépassement du reste PO bloquant", () => {
    const { errors } = checkSubmission(allWorkingDays, ctx({ poRemainingHalfDays: 10 }));
    expect(errors).toContainEqual({ code: "PO_BUDGET_EXCEEDED" });
  });

  it("week-end travaillé sans motif bloquant, avec motif accepté", () => {
    const sat = work("2026-10-03");
    expect(checkSubmission([...allWorkingDays, sat], ctx()).errors).toEqual([
      { code: "NON_WORKING_DAY_NEEDS_REASON", date: "2026-10-03" },
    ]);
    expect(checkSubmission([...allWorkingDays, { ...sat, exceptionReason: "MEP" }], ctx()).errors).toEqual([]);
  });

  it("dates hors mois, hors contrat, en double", () => {
    const { errors } = checkSubmission(
      [work("2026-09-30"), work("2026-10-01"), work("2026-10-01"), work("2026-10-20")],
      ctx({ periods: [{ start: "2026-10-01", end: "2026-10-15" }] }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        { code: "OUTSIDE_MONTH", date: "2026-09-30" },
        { code: "DUPLICATE_DATE", date: "2026-10-01" },
        { code: "OUTSIDE_CONTRACT", date: "2026-10-20" },
      ]),
    );
  });

  it("jours ouvrés non saisis : avertissement non bloquant, hors fériés", () => {
    const days = allWorkingDays.filter((d) => d.date !== "2026-10-05" && d.date !== "2026-10-06");
    const { errors, warnings } = checkSubmission(days, ctx({ holidays: new Set(["2026-10-06"]) }));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([{ code: "UNFILLED_WORKING_DAYS", count: 1, date: "2026-10-05" }]);
  });

  it("mois futur bloquant, mois en cours en avertissement", () => {
    expect(checkSubmission(allWorkingDays, ctx({ today: "2026-09-20" })).errors).toContainEqual({ code: "FUTURE_MONTH" });
    expect(checkSubmission(allWorkingDays.slice(0, 5), ctx({ today: "2026-10-08" })).warnings).toContainEqual({
      code: "MONTH_NOT_OVER",
    });
  });

  it("deux périodes de contrat sur le même PO : les deux sont saisissables, pas l'intervalle", () => {
    const periods = [
      { start: "2026-10-01", end: "2026-10-09" },
      { start: "2026-10-19", end: "2026-10-31" },
    ];
    const { errors } = checkSubmission([work("2026-10-05"), work("2026-10-20"), work("2026-10-14")], ctx({ periods }));
    expect(errors).toEqual([{ code: "OUTSIDE_CONTRACT", date: "2026-10-14" }]);
  });

  it("taux différents dans le mois : bloquant", () => {
    expect(checkSubmission(allWorkingDays, ctx({ mixedRates: true })).errors).toEqual([{ code: "MIXED_RATES" }]);
  });

  it("signature manquante : bloquant à la soumission uniquement", () => {
    expect(checkSubmission(allWorkingDays, ctx({ hasSignature: false })).errors).toEqual([{ code: "SIGNATURE_MISSING" }]);
    expect(checkSubmission(allWorkingDays, ctx()).errors).toEqual([]);
  });
});
