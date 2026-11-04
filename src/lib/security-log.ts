import "server-only";
import { db } from "@/lib/db";

/** Masque une adresse e-mail pour les journaux (c***@exemple.com). */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  return domain ? `${local.slice(0, 1)}***@${domain}` : "***";
}

/**
 * Événement de sécurité (connexions, refus d'accès, appels non autorisés) : journal d'audit
 * (entité « Security ») + ligne structurée sur la sortie d'erreur pour la supervision.
 * Ne doit jamais faire échouer la requête qui l'émet.
 */
export async function securityEvent(action: string, details: { actorId?: string | null; [key: string]: unknown } = {}) {
  const { actorId = null, ...payload } = details;
  console.warn(JSON.stringify({ level: "security", action, actorId, ...payload, at: new Date().toISOString() }));
  try {
    await db.auditLog.create({
      data: { actorId, entity: "Security", entityId: actorId ?? "anonyme", action, payload: payload as object },
    });
  } catch {
    /* journalisation au mieux */
  }
}
