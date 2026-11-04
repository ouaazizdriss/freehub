import { describe, expect, it } from "vitest";
import { tenantFromIssuer, trustedIdentity } from "../entra";

const T = "3f1c2b6a-9d4e-4c1b-8a2f-0e5d6c7b8a90";
const OID = "aa11bb22-cc33-4d44-8e55-ff6677889900";

describe("tenantFromIssuer", () => {
  it("accepte l'émetteur d'un tenant précis", () => {
    expect(tenantFromIssuer(`https://login.microsoftonline.com/${T}/v2.0`)).toBe(T);
    expect(tenantFromIssuer(`https://login.microsoftonline.com/${T.toUpperCase()}/v2.0/`)).toBe(T);
  });
  it("refuse absent, multi-tenant ou autre hôte", () => {
    for (const issuer of [
      undefined,
      "",
      "https://login.microsoftonline.com/common/v2.0",
      "https://login.microsoftonline.com/organizations/v2.0",
      "https://login.microsoftonline.com/consumers/v2.0",
      `https://evil.example/${T}/v2.0`,
    ]) {
      expect(tenantFromIssuer(issuer)).toBeNull();
    }
  });
});

describe("trustedIdentity", () => {
  it("oid valide du bon tenant", () => {
    expect(trustedIdentity({ oid: OID, tid: T }, T)).toBe(OID);
  });
  it("refuse un autre tenant, un oid absent ou malformé, un tenant non configuré", () => {
    expect(trustedIdentity({ oid: OID, tid: "00000000-0000-4000-8000-000000000000" }, T)).toBeNull();
    expect(trustedIdentity({ tid: T }, T)).toBeNull();
    expect(trustedIdentity({ oid: "x", tid: T }, T)).toBeNull();
    expect(trustedIdentity({ oid: OID, tid: T }, null)).toBeNull();
  });
});
