import "server-only";
import type { CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";

/** CRA visibles : les siens pour un freelance, tous pour l'admin. */
export async function listTimesheets(user: CurrentUser) {
  return db.timesheet.findMany({
    where: user.role === "FREELANCE" ? { freelancer: { userId: user.id } } : {},
    orderBy: [{ month: "desc" }],
    take: 50,
    select: {
      id: true,
      purchaseOrderId: true,
      month: true,
      status: true,
      totalWorkHalfDays: true,
      totalOvertimeHours: true,
      totalOnCall: true,
      totalAmountCents: true,
      freelancer: { select: { user: { select: { name: true } } } },
      purchaseOrder: { select: { number: true, mission: { select: { name: true } } } },
    },
  });
}
