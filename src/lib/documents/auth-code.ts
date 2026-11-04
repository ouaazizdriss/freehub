import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Code d'authenticité d'un CRA : CRA-<MMYY>-<PO>-<clé>.
 * - clé = HMAC-SHA256(secret serveur, id | statut | empreinte du contenu), 10 caractères base32
 *   (50 bits : énumération impraticable) ;
 * - le code change si le contenu OU le statut change (soumis → validé) ;
 * - la vérification recalcule le code depuis les données en base : une modification directe
 *   en base invalide le document.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // base32 Crockford (sans I, L, O, U)

function base32(bytes: Buffer, length: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= length) break;
  }
  return out;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type CodeInput = { id: string; status: string; contentHash: string; poNumber: string; year: number; month1: number };

export const AUTH_CODE_PATTERN = /^CRA-\d{4}-[0-9A-Z]{1,8}-[0-9A-Z]{10}$/;

export function computeAuthCode(input: CodeInput, secret: string): string {
  if (!secret || secret.length < 32)
    throw new Error("Secret du code d'authenticité absent ou trop court (32 caractères minimum)");
  const mac = createHmac("sha256", secret).update(`${input.id}|${input.status}|${input.contentHash}`, "utf8").digest();
  const period = `${String(input.month1).padStart(2, "0")}${String(input.year % 100).padStart(2, "0")}`;
  const po = (
    input.poNumber
      .replace(/[^0-9A-Z]/gi, "")
      .toUpperCase()
      .slice(-4) || "0000"
  ).padStart(4, "0");
  return `CRA-${period}-${po}-${base32(mac, 10)}`;
}

/** Comparaison à temps constant (pas de fuite par le temps de réponse). */
export function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Secret du code : AUTH_CODE_SECRET (≥ 32 caractères, distinct du secret des sessions).
 * Repli sur AUTH_SECRET uniquement en développement local et en test.
 */
export function authCodeSecret(): string {
  const dedicated = process.env.AUTH_CODE_SECRET?.trim() || undefined;
  const localOnly = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const secret = dedicated ?? (localOnly ? process.env.AUTH_SECRET?.trim() || undefined : undefined);
  if (!secret) throw new Error("AUTH_CODE_SECRET doit être défini (hors développement local)");
  if (dedicated && dedicated === process.env.AUTH_SECRET?.trim())
    throw new Error("AUTH_CODE_SECRET doit être distinct de AUTH_SECRET");
  return secret;
}
