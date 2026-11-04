/** Règles de confiance Entra ID — module pur (testé). */
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant de l'émetteur https://login.microsoftonline.com/<tenant-id>/v2.0, ou null si l'émetteur
 * est absent, mal formé ou multi-tenant (common / organizations / consumers) : à refuser (nOAuth).
 */
export function tenantFromIssuer(issuer: string | undefined): string | null {
  const match = (issuer ?? "").match(/^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0\/?$/);
  return match && GUID.test(match[1]) ? match[1].toLowerCase() : null;
}

/** Identité Entra acceptable : `oid` valide et `tid` égal au tenant de l'entreprise. */
export function trustedIdentity(profile: { oid?: unknown; tid?: unknown } | undefined, tenant: string | null) {
  const oid = typeof profile?.oid === "string" ? profile.oid.toLowerCase() : null;
  const tid = typeof profile?.tid === "string" ? profile.tid.toLowerCase() : null;
  return oid && GUID.test(oid) && tenant && tid === tenant ? oid : null;
}
