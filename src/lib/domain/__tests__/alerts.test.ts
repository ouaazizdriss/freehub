import { describe, expect, it } from "vitest";
import { buildAlerts, daysBetween, documentStates, freelancerStatus, poHealth, reminderFor, type AlertInput } from "../alerts";

const today = "2026-11-03";

describe("daysBetween", () => {
  it("compte les jours calendaires, changement de mois inclus", () => {
    expect(daysBetween("2026-10-30", "2026-11-03")).toBe(4);
    expect(daysBetween("2026-11-03", "2026-11-01")).toBe(-2);
  });
});

describe("poHealth", () => {
  it("ok / tendu (≥ 85 %) / dépassé", () => {
    expect(poHealth(100, 50).level).toBe("ok");
    expect(poHealth(100, 85).level).toBe("tight");
    expect(poHealth(100, 101).level).toBe("exceeded");
    expect(poHealth(0, 0)).toEqual({ ratio: 0, level: "ok" });
  });
});

describe("documentStates", () => {
  it("manquant, expiré, bientôt expiré, valable ; la pièce la plus récente fait foi", () => {
    const states = documentStates(
      [
        { kind: "URSSAF", expiresAt: "2026-10-01" },
        { kind: "URSSAF", expiresAt: "2027-04-01" },
        { kind: "INSURANCE", expiresAt: "2026-11-20" },
      ],
      today,
    );
    expect(states).toEqual({ URSSAF: "ok", INSURANCE: "expiring", KBIS: "missing" });
    expect(documentStates([{ kind: "KBIS", expiresAt: "2026-11-02" }], today).KBIS).toBe("expired");
    expect(documentStates([{ kind: "KBIS", expiresAt: null }], today).KBIS).toBe("ok");
  });
});

describe("freelancerStatus", () => {
  const docsOk = { URSSAF: "ok", INSURANCE: "ok", KBIS: "expiring" } as const;
  it("priorité : hors mission, docs KO, fin proche, PO tendu, active", () => {
    expect(freelancerStatus({ contractEnd: "2026-10-31", poLevel: "ok", docs: docsOk, today })).toBe("INACTIVE");
    expect(freelancerStatus({ contractEnd: "2026-11-20", poLevel: "tight", docs: { ...docsOk, KBIS: "missing" }, today })).toBe(
      "DOCS_KO",
    );
    expect(freelancerStatus({ contractEnd: "2026-11-20", poLevel: "tight", docs: docsOk, today })).toBe("ENDING");
    expect(freelancerStatus({ contractEnd: "2027-06-30", poLevel: "tight", docs: docsOk, today })).toBe("PO_TIGHT");
    expect(freelancerStatus({ contractEnd: "2027-06-30", poLevel: "ok", docs: docsOk, today })).toBe("ACTIVE");
  });
});

describe("buildAlerts", () => {
  const base: AlertInput = { today, purchaseOrders: [], contracts: [], documents: [], late: [], closingLabel: "Octobre 2026" };

  it("rien à signaler", () => {
    expect(buildAlerts(base)).toEqual([]);
  });

  it("trie par gravité et regroupe documents et retards", () => {
    const alerts = buildAlerts({
      ...base,
      purchaseOrders: [{ number: "PO-1", mission: "M", budgetHalfDays: 100, consumedHalfDays: 90 }],
      contracts: [
        { freelancer: "A", freelancerId: "a", mission: "M", endDate: "2026-11-06" },
        { freelancer: "B", freelancerId: "b", mission: "M", endDate: "2027-01-31" },
      ],
      documents: [{ freelancer: "C", freelancerId: "c", states: { URSSAF: "expired" } }],
      late: [{ freelancer: "D", freelancerId: "d", mission: "M" }],
    });
    expect(alerts.map((a) => a.kind)).toEqual(["CONTRACT_ENDING", "DOCS_EXPIRED", "CRA_LATE", "PO_TIGHT"]);
    expect(alerts[0].title).toBe("Fin de mission dans 3 j");
  });
});

describe("reminderFor", () => {
  it("J-3 puis lendemain de l'échéance", () => {
    expect(reminderFor("2026-11-02", "2026-11-05")).toBe("J-3");
    expect(reminderFor("2026-11-06", "2026-11-05")).toBe("LATE");
    expect(reminderFor("2026-11-04", "2026-11-05")).toBeNull();
  });
});
