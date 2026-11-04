import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { reminderFor } from "@/lib/domain/alerts";
import { closingPeriod, formatLongDate, formatMonth, isoDate, todayIso } from "@/lib/domain/calendar";
import { reminderMail, sendMail } from "@/lib/notify";
import { fromIso } from "@/lib/queries/cra-editor";
import { expectedTimesheets } from "@/lib/queries/referential";
import { Prisma } from "@/generated/prisma/client";

/**
 * Relances automatiques (à appeler une fois par jour par un planificateur : cron, Azure Logic App…).
 *   POST /api/cron/reminders   Authorization: Bearer $CRON_SECRET
 * J-3 avant l'échéance : rappel aux freelances dont un CRA attendu du mois de clôture n'est pas
 * soumis ; lendemain de l'échéance : avis de retard. Une relance par (freelance, mois, type) :
 * elle est réservée en base (contrainte d'unicité) AVANT l'envoi.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  await connection();
  if (!authorized(request)) return new Response("Non autorisé", { status: 401 });

  const url = new URL(request.url);
  // ?date=AAAA-MM-JJ : rejouer une journée (tests, rattrapage) ; sinon aujourd'hui.
  const forced = url.searchParams.get("date");
  const today = forced && /^\d{4}-\d{2}-\d{2}$/.test(forced) ? forced : todayIso();
  // Période dont l'échéance tombe dans 3 jours (période en cours), ou a expiré hier (période précédente).
  const candidates = [closingPeriod(today), closingPeriod(isoDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1))];
  const target = candidates.map((p) => ({ ...p, kind: reminderFor(today, p.deadline) })).find((p) => p.kind);
  if (!target?.kind) return Response.json({ today, sent: 0, reason: "Pas de relance ce jour" });

  const { missing } = await expectedTimesheets({}, target.year, target.month1);
  const month = fromIso(isoDate(target.year, target.month1, 1));
  const label = formatMonth(target.year, target.month1);
  const deadline = formatLongDate(target.deadline);
  const byFreelancer = new Map(missing.map((m) => [m.freelancerId, m]));

  let sent = 0;
  for (const m of byFreelancer.values()) {
    try {
      await db.reminderLog.create({ data: { freelancerId: m.freelancerId, month, kind: target.kind } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // déjà relancé
      throw e;
    }
    const ok = await sendMail(reminderMail({ to: m.email, name: m.freelancer, month: label, deadline, kind: target.kind }));
    if (ok) sent++;
    // Échec d'envoi : la réservation est retirée pour qu'une nouvelle exécution du jour réessaie.
    else await db.reminderLog.deleteMany({ where: { freelancerId: m.freelancerId, month, kind: target.kind } });
  }
  return Response.json({ today, period: isoDate(target.year, target.month1, 1).slice(0, 7), kind: target.kind, sent });
}
