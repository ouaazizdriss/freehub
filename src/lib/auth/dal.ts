import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

export type CurrentUser = { id: string; name: string; email: string; role: Role };

/**
 * Data Access Layer : point unique de vérification de session.
 * Le rôle est relu en base (pas dans le JWT) : un changement de droits ou une
 * désactivation prend effet immédiatement, sans attendre l'expiration du jeton.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Auth.js consomme crypto.getRandomValues() avant de lire les cookies : sans ce marqueur
  // de requête, Cache Components tente de prérendre l'appel et lève une erreur.
  await connection();
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user?.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** À appeler dans chaque page, Server Action et Route Handler protégé. */
export async function requireRole(allowed: readonly Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) redirect("/forbidden");
  return user;
}
