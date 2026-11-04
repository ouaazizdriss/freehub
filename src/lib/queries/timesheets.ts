import "server-only";
import { cache } from "react";
import type { CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { timesheetScope } from "./validation";

/** CRA en attente de validation dans le périmètre de l'utilisateur (badge de la sidebar). */
// Mis en cache par requête : la navigation est rendue deux fois (tiroir mobile + sidebar).
export const pendingValidationCount = cache(async (user: CurrentUser): Promise<number> => {
  if (user.role === "FREELANCE") return 0;
  return db.timesheet.count({ where: { ...timesheetScope(user), status: "SUBMITTED" } });
});
