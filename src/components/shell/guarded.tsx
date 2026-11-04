import type { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/auth/dal";

/**
 * Contrôle de rôle côté serveur pour un contenu de page.
 * À placer sous <Suspense> : la page garde son en-tête statique (navigation instantanée),
 * le contenu protégé n'est rendu — ni envoyé au navigateur — qu'après vérification.
 */
export async function Guarded({ roles, children }: { roles: readonly Role[]; children: React.ReactNode }) {
  await requireRole(roles);
  return <>{children}</>;
}
