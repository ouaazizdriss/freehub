import { db } from "@/lib/db";
import { authorize, fileName } from "@/lib/documents/http";
import { getFile } from "@/lib/storage";
import { limited, tooManyRequests } from "@/lib/rate-limit";

/**
 * Export des données personnelles d'un freelance (droit d'accès / portabilité, RGPD art. 15 et 20).
 * Le freelance exporte ses propres données ; l'admin peut exporter celles de n'importe quel freelance
 * (?freelance=<id>). Les fichiers (pièces, signature) ne sont pas inclus : téléchargeables séparément.
 */
export async function GET(request: Request) {
  const user = await authorize(["FREELANCE", "ADMIN"], request);
  if (user instanceof Response) return user;
  if (await limited("rgpdExport", user.id)) return tooManyRequests();
  const requested = new URL(request.url).searchParams.get("freelance");
  const where = user.role === "FREELANCE" ? { userId: user.id } : { id: requested ?? "" };

  const data = await db.freelancer.findFirst({
    where,
    select: {
      id: true,
      jobTitle: true,
      company: true,
      siret: true,
      createdAt: true,
      user: { select: { name: true, email: true, role: true, active: true, createdAt: true } },
      contracts: {
        select: {
          startDate: true,
          endDate: true,
          dailyRateCents: true,
          overtimeHourlyRateCents: true,
          onCallRateCents: true,
          currency: true,
          mission: { select: { name: true } },
        },
      },
      timesheets: {
        orderBy: { month: "asc" },
        select: {
          month: true,
          status: true,
          dailyRateCents: true,
          overtimeHourlyRateCents: true,
          onCallRateCents: true,
          totalAbsenceHalfDays: true,
          submittedAt: true,
          validatedAt: true,
          rejectionReason: true,
          totalWorkHalfDays: true,
          totalOvertimeHours: true,
          totalOnCall: true,
          totalAmountCents: true,
          authCode: true,
          purchaseOrder: { select: { number: true } },
          days: {
            orderBy: { date: "asc" },
            select: {
              date: true,
              workHalfDays: true,
              absenceHalfDays: true,
              half: true,
              overtimeHours: true,
              onCall: true,
              comment: true,
              exceptionReason: true,
            },
          },
        },
      },
      absences: { select: { kind: true, startDate: true, endDate: true, comment: true, createdAt: true } },
      documents: { select: { kind: true, expiresAt: true, fileName: true, uploadedAt: true } },
      signature: { select: { uploadedAt: true, fileKey: true } },
    },
  });
  if (!data) return new Response("Freelance introuvable", { status: 404 });

  const [auditTrail, reminders, signatureFile] = await Promise.all([
    db.auditLog.findMany({
      where: { actor: { freelancer: { id: data.id } } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, entity: true, action: true },
    }),
    db.reminderLog.findMany({ where: { freelancerId: data.id }, select: { month: true, kind: true, sentAt: true } }),
    data.signature ? getFile(data.signature.fileKey) : Promise.resolve(null),
  ]);
  const { signature, ...rest } = data;

  await db.auditLog.create({ data: { actorId: user.id, entity: "Freelancer", entityId: data.id, action: "RGPD_EXPORT" } });
  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      generator: "Freelance Hub",
      data: {
        ...rest,
        signature: signature
          ? { uploadedAt: signature.uploadedAt, imagePngBase64: signatureFile?.toString("base64") ?? null }
          : null,
        auditTrail,
        reminders,
      },
    },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName("donnees", data.user.name)}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
