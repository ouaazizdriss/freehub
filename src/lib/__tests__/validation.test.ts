import { describe, expect, it } from "vitest";
import { isCalendarDate } from "../validation";
import { isStorageKey } from "../storage-keys";

describe("isCalendarDate", () => {
  it("accepte les dates réelles, y compris le 29 février bissextile", () => {
    expect(isCalendarDate("2026-11-04")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
  });
  it("refuse les dates inexistantes ou mal formées", () => {
    for (const v of ["2026-02-31", "2026-13-01", "2027-02-29", "2026-1-01", "", "2026-11-04T00:00"])
      expect(isCalendarDate(v)).toBe(false);
  });
});

describe("isStorageKey", () => {
  it("n'accepte que les clés générées par le serveur", () => {
    expect(isStorageKey("signatures/0b6f1c2e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.png")).toBe(true);
    for (const k of [
      "../.env",
      "signatures/../../etc/passwd",
      "documents/x.pdf",
      "signatures/0b6f1c2e-1d2a-4c3b-9e8f-7a6b5c4d3e2f.svg",
    ]) {
      expect(isStorageKey(k)).toBe(false);
    }
  });
});
