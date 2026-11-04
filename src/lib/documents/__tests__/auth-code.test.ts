import { describe, expect, it } from "vitest";
import { AUTH_CODE_PATTERN, computeAuthCode, sameCode, sha256 } from "../auth-code";

const SECRET = "test-secret-at-least-thirty-two-chars-long";
const base = { id: "ts_1", status: "SUBMITTED", contentHash: sha256("contenu"), poNumber: "PO-2026-0417", year: 2026, month1: 7 };

describe("computeAuthCode", () => {
  it("format CRA-MMYY-PO-clé", () => {
    const code = computeAuthCode(base, SECRET);
    expect(code).toMatch(AUTH_CODE_PATTERN);
    expect(code.startsWith("CRA-0726-0417-")).toBe(true);
  });

  it("déterministe", () => {
    expect(computeAuthCode(base, SECRET)).toBe(computeAuthCode({ ...base }, SECRET));
  });

  it("change avec le statut, le contenu, l'identifiant et le secret", () => {
    const code = computeAuthCode(base, SECRET);
    expect(computeAuthCode({ ...base, status: "VALIDATED" }, SECRET)).not.toBe(code);
    expect(computeAuthCode({ ...base, contentHash: sha256("autre") }, SECRET)).not.toBe(code);
    expect(computeAuthCode({ ...base, id: "ts_2" }, SECRET)).not.toBe(code);
    expect(computeAuthCode(base, `${SECRET}-2`)).not.toBe(code);
  });

  it("refuse un secret trop court", () => {
    expect(() => computeAuthCode(base, "court")).toThrow();
  });

  it("sameCode", () => {
    expect(sameCode("CRA-0726-0417-ABCDEFGHJK", "CRA-0726-0417-ABCDEFGHJK")).toBe(true);
    expect(sameCode("CRA-0726-0417-ABCDEFGHJK", "CRA-0726-0417-ABCDEFGHJM")).toBe(false);
    expect(sameCode("a", "ab")).toBe(false);
  });
});
