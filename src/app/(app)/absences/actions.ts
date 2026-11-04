"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { ABSENCE_LABELS, MAX_ABSENCE_DAYS } from "@/lib/domain/absences";
import { daysBetween } from "@/lib/domain/alerts";
import { formatLongDate, todayIso } from "@/lib/domain/calendar";
import { appUrl, sendMail } from "@/lib/notify";
import type { FormState } from "@/app/(app)/freelances/actions";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");

const declareSchema = z
  .object({
    kind: z.enum(["LEAVE", "UNAVAILABLE", "SICK"], "Type d'absence invalide"),
    start: isoDate,
    end: isoDate,
    comment: z
      .string()
      .trim()
      .max(300, "300 caractères maximum")
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((a) => a.end >= a.start, { path: ["end"], message: "La fin précède le début" })
  .refine((a) => daysBetween(a.start, a.end) < MAX_ABSENCE_DAYS, { path: ["end"], message: `${MAX_ABSENCE_DAYS} jours maximum` });

/**
 * Déclaration d'absence par le freelance. Rétroactivité limitée à 31 jours (au-delà, le CRA du mois
 * est en principe clos) ; pas de chevauchement avec une absence déjà déclarée. Le manager de chaque
 * mission en cours est prévenu.
 */
export async function declareAbsence(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(["FREELANCE"]);
  const parsed = declareSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, message: "Vérifiez les champs signalés.", errors };
  }
  const a = parsed.data;
  if (daysBetween(a.start, todayIso()) > 31) {
    return { ok: false, message: "Déclaration rétroactive limitée à 31 jours.", errors: { start: "Trop ancienne" } };
  }
  const freelancer = await db.freelancer.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!freelancer) return { ok: false, message: "Fiche freelance introuvable." };
  const start = new Date(`${a.start}T00:00:00Z`);
  const end = new Date(`${a.end}T00:00:00Z`);

  const created = await db.$transaction(async (tx) => {
    // Sérialise les déclarations d'un même freelance (contrôle de chevauchement fiable).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`absence:${freelancer.id}`}))`;
    const overlap = await tx.absence.count({ where: { freelancerId: freelancer.id, startDate: { lte: end }, endDate: { gte: start } } });
    if (overlap > 0) return null;
    const absence = await tx.absence.create({
      data: { freelancerId: freelancer.id, kind: a.kind, startDate: start, endDate: end, comment: a.comment },
      select: { id: true },
    });
    await tx.auditLog.create({ data: { actorId: user.id, entity: "Absence", entityId: absence.id, action: "DECLARE", payload: { kind: a.kind } } });
    return absence;
  });
  if (!created) return { ok: false, message: "Une absence est déjà déclarée sur tout ou partie de ces dates.", errors: { start: "Chevauchement" } };

  const managers = await managersFor(freelancer.id, start, end);
  notify(managers, `Absence déclarée : ${user.name}`, `${user.name} a déclaré : ${ABSENCE_LABELS[a.kind]} du ${formatLongDate(a.start)} au ${formatLongDate(a.end)}.`);
  refresh();
  return {
    ok: true,
    message: managers.length > 0 ? "Absence déclarée. Votre manager est prévenu." : "Absence déclarée (aucune mission en cours sur ces dates).",
  };
}

/** Managers des missions du freelance actives sur la période. */
async function managersFor(freelancerId: string, start: Date, end: Date) {
  return db.user.findMany({
    where: { active: true, managedMissions: { some: { contracts: { some: { freelancerId, startDate: { lte: end }, endDate: { gte: start } } } } } },
    select: { name: true, email: true },
  });
}

/** Envoi après la réponse ; un échec n'empêche pas les envois suivants. */
function notify(managers: { name: string; email: string }[], subject: string, body: string) {
  if (managers.length === 0) return;
  after(() =>
    Promise.allSettled(
      managers.map((m) =>
        sendMail({ to: m.email, subject, text: `Bonjour ${m.name},\n\n${body}\nPlan de charge : ${appUrl("/absences")}\n\n— Freelance Hub` }),
      ),
    ),
  );
}

/** Annulation : par le freelance pour une absence qui n'a pas commencé, ou par l'admin. */
export async function cancelAbsence(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(["FREELANCE", "ADMIN"]);
  const id = z.string().min(1).safeParse(data.get("id"));
  if (!id.success) return { ok: false, message: "Absence introuvable." };
  const absence = await db.absence.findFirst({
    where: { id: id.data, ...(user.role === "FREELANCE" ? { freelancer: { userId: user.id } } : {}) },
    select: { id: true, kind: true, startDate: true, endDate: true, freelancerId: true, freelancer: { select: { user: { select: { name: true } } } } },
  });
  if (!absence) return { ok: false, message: "Absence introuvable." };
  if (user.role === "FREELANCE" && absence.startDate.toISOString().slice(0, 10) <= todayIso()) {
    return { ok: false, message: "Une absence commencée ne peut plus être annulée : contactez l'administrateur." };
  }
  await db.$transaction([
    db.absence.delete({ where: { id: absence.id } }),
    db.auditLog.create({ data: { actorId: user.id, entity: "Absence", entityId: absence.id, action: "CANCEL" } }),
  ]);
  const managers = await managersFor(absence.freelancerId, absence.startDate, absence.endDate);
  notify(
    managers,
    `Absence annulée : ${absence.freelancer.user.name}`,
    `L'absence de ${absence.freelancer.user.name} (${ABSENCE_LABELS[absence.kind]} du ${formatLongDate(absence.startDate.toISOString().slice(0, 10))} au ${formatLongDate(absence.endDate.toISOString().slice(0, 10))}) a été annulée.`,
  );
  refresh();
  return { ok: true, message: "Absence annulée." };
}
