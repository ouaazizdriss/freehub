import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";
import { loadDocument, sealTimesheet, type TimesheetDocument } from "./content";

/** Contrôle d'accès des Route Handlers : codes HTTP explicites plutôt qu'une redirection. */
export async function authorize(roles?: readonly Role[]): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Authentification requise", { status: 401 });
  if (roles && !roles.includes(user.role)) return new Response("Accès refusé", { status: 403 });
  return user;
}

/**
 * Document d'un CRA (périmètre vérifié). Un CRA soumis/validé sans code (données antérieures
 * au Lot 3, seed) est scellé à la volée avant la génération.
 */
export async function documentFor(user: CurrentUser, id: string): Promise<TimesheetDocument | null> {
  const doc = await loadDocument(user, id);
  if (!doc || doc.authCode || (doc.status !== "SUBMITTED" && doc.status !== "VALIDATED")) return doc;
  await db.$transaction((tx) => sealTimesheet(tx, id, { onlyIfUnsealed: true }));
  return loadDocument(user, id);
}

export async function logDownload(user: CurrentUser, timesheetId: string, action: "PDF_DOWNLOAD" | "XLSX_DOWNLOAD") {
  await db.auditLog.create({ data: { actorId: user.id, entity: "Timesheet", entityId: timesheetId, action } });
}

/** Nom de fichier ASCII sûr pour Content-Disposition. */
export function fileName(...parts: string[]): string {
  return parts
    .join("-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function fileResponse(body: Buffer, type: string, name: string, disposition: "inline" | "attachment") {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${disposition}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
