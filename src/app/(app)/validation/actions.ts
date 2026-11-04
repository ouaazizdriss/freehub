"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole, type CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { isClean, MAX_REJECTION_REASON, MIN_REJECTION_REASON } from "@/lib/domain/attention";
import { formatMonth } from "@/lib/domain/calendar";
import { sendMail, timesheetRejectedMail, timesheetValidatedMail } from "@/lib/notify";
import { getValidationDetail, timesheetScope, VALIDATION_DECIDERS } from "@/lib/queries/validation";
import { onTimesheetValidated } from "@/lib/documents/lifecycle";
import { Prisma } from "@/generated/prisma/client";

export type DecisionResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "CONFLICT" | "INVALID"; message?: string };

const decisionSchema = z.object({ id: z.string().min(1), version: z.int().nonnegative() });
const rejectSchema = decisionSchema.extend({
  reason: z.string().trim().min(MIN_REJECTION_REASON).max(MAX_REJECTION_REASON),
});

type Decided = { to: string; name: string; month: string; mission: string; decidedBy: string };

/**
 * Transition SUBMITTED → VALIDATED | REJECTED, dans le périmètre du décideur.
 * La mise à jour est conditionnée au statut et à la version lus : deux décisions
 * concurrentes (deux managers, double clic) ne peuvent pas s'appliquer toutes les deux.
 */
async function decide(
  user: CurrentUser,
  id: string,
  version: number,
  decision: { kind: "VALIDATE" } | { kind: "REJECT"; reason: string },
): Promise<{ ok: true; mail: Decided } | Exclude<DecisionResult, { ok: true }>> {
  return db.$transaction(async (tx) => {
    const ts = await tx.timesheet.findFirst({
      where: { id, ...timesheetScope(user) },
      select: {
        id: true,
        status: true,
        version: true,
        month: true,
        freelancer: { select: { user: { select: { name: true, email: true } } } },
        purchaseOrder: { select: { mission: { select: { name: true } } } },
      },
    });
    if (!ts) return { ok: false, error: "NOT_FOUND" };
    if (ts.status !== "SUBMITTED" || ts.version !== version) return { ok: false, error: "CONFLICT" };

    const now = new Date();
    const updated = await tx.timesheet.updateMany({
      where: { id, status: "SUBMITTED", version },
      data:
        decision.kind === "VALIDATE"
          ? { status: "VALIDATED", version: { increment: 1 }, validatedAt: now, validatedById: user.id, rejectionReason: null }
          : {
              status: "REJECTED",
              version: { increment: 1 },
              rejectionReason: decision.reason,
              validatedAt: null,
              validatedById: null,
              // Le document soumis n'est plus valable : son code ne doit plus se vérifier.
              authCode: null,
              contentHash: null,
              submittedCode: null,
              // Contenu figé à nouveau à la prochaine soumission
              snapshot: Prisma.DbNull,
            },
    });
    if (updated.count === 0) return { ok: false, error: "CONFLICT" };

    if (decision.kind === "VALIDATE") await onTimesheetValidated(tx, id);

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        entity: "Timesheet",
        entityId: id,
        action: decision.kind,
        payload: decision.kind === "REJECT" ? { reason: decision.reason } : undefined,
      },
    });
    return {
      ok: true,
      mail: {
        to: ts.freelancer.user.email,
        name: ts.freelancer.user.name,
        month: formatMonth(ts.month.getUTCFullYear(), ts.month.getUTCMonth() + 1),
        mission: ts.purchaseOrder.mission.name,
        decidedBy: user.name,
      },
    };
  });
}

export async function validateTimesheet(input: z.input<typeof decisionSchema>): Promise<DecisionResult> {
  const user = await requireRole(VALIDATION_DECIDERS);
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const result = await decide(user, parsed.data.id, parsed.data.version, { kind: "VALIDATE" });
  if (!result.ok) return result;
  // Envoi après la réponse : un SMTP lent ne retarde ni ne fait échouer la décision.
  after(() => sendMail(timesheetValidatedMail(result.mail)));
  refresh();
  return { ok: true };
}

export async function requestCorrection(input: z.input<typeof rejectSchema>): Promise<DecisionResult> {
  const user = await requireRole(VALIDATION_DECIDERS);
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "INVALID", message: `Motif obligatoire (${MIN_REJECTION_REASON} à ${MAX_REJECTION_REASON} caractères).` };
  }
  const { id, version, reason } = parsed.data;
  const result = await decide(user, id, version, { kind: "REJECT", reason });
  if (!result.ok) return result;
  after(() => sendMail(timesheetRejectedMail({ ...result.mail, reason })));
  refresh();
  return { ok: true };
}

/** Garde-fou : nombre max. de CRA traités par « Tout valider » en une fois */
const BULK_LIMIT = 300;

/**
 * « Tout valider » : le serveur relit lui-même la file (périmètre de l'utilisateur) et ne valide
 * que les CRA sans avertissement, chacun dans sa propre transaction avec contrôle de version.
 * Les autres restent dans la file pour un examen individuel.
 */
export async function validateAllClean(): Promise<{ validated: number; skipped: number; remaining: number }> {
  const user = await requireRole(VALIDATION_DECIDERS);
  const where = { ...timesheetScope(user), status: "SUBMITTED" as const };
  const queue = await db.timesheet.findMany({ where, orderBy: { submittedAt: "asc" }, take: BULK_LIMIT, select: { id: true } });

  let validated = 0;
  let skipped = 0;
  const mails: Decided[] = [];
  for (const { id } of queue) {
    const detail = await getValidationDetail(user, id);
    if (!detail || detail.status !== "SUBMITTED" || !isClean(detail.points)) {
      skipped++;
      continue;
    }
    // Version relue à l'instant : si le CRA change entre ce contrôle et la décision, decide() échoue.
    const result = await decide(user, id, detail.version, { kind: "VALIDATE" });
    if (result.ok) {
      validated++;
      mails.push(result.mail);
    } else skipped++;
  }
  after(async () => {
    for (const mail of mails) await sendMail(timesheetValidatedMail(mail));
  });
  refresh();
  const remaining = Math.max(0, (await db.timesheet.count({ where })) - skipped);
  return { validated, skipped, remaining };
}
