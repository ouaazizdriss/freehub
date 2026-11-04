import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Limitation de débit à fenêtre fixe, stockée en base (fonctionne avec plusieurs instances).
 * Une seule requête atomique (INSERT … ON CONFLICT … RETURNING) par appel.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  // Nettoyage opportuniste des fenêtres expirées (≈ 1 appel sur 100).
  if (Math.random() < 0.01) await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
  return (rows[0]?.count ?? 0) <= limit;
}

/** Adresse IP du client (premier saut de X-Forwarded-For, posé par le reverse proxy de confiance). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "inconnue";
}

/** Limites par action (nombre, fenêtre en secondes) */
export const LIMITS = {
  pdf: [60, 600],
  xlsx: [60, 600],
  monthlyExport: [10, 600],
  rgpdExport: [5, 3600],
  signatureUpload: [10, 3600],
  verify: [30, 60],
  login: [20, 300],
} as const satisfies Record<string, readonly [number, number]>;

export async function limited(action: keyof typeof LIMITS, subject: string): Promise<boolean> {
  const [limit, window] = LIMITS[action];
  return !(await rateLimit(`${action}:${subject}`, limit, window));
}

export const tooManyRequests = () =>
  new Response("Trop de requêtes : réessayez dans quelques minutes.", { status: 429, headers: { "Retry-After": "60" } });
