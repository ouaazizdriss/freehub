import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { sealTimesheet } from "./content";

/**
 * Hooks appelés dans la transaction des transitions de statut.
 * Le code d'authenticité couvre le contenu ET le statut : il est recalculé à chaque transition
 * (le document « provisoire » et le document « validé » n'ont pas le même code).
 */
export async function onTimesheetSubmitted(tx: Prisma.TransactionClient, timesheetId: string): Promise<void> {
  await sealTimesheet(tx, timesheetId);
}

export async function onTimesheetValidated(tx: Prisma.TransactionClient, timesheetId: string): Promise<void> {
  await sealTimesheet(tx, timesheetId);
}
