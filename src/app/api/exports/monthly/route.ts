import { db } from "@/lib/db";
import { loadMonthDocuments, sealTimesheet } from "@/lib/documents/content";
import { authorize, fileName, fileResponse } from "@/lib/documents/http";
import { monthlyWorkbook } from "@/lib/documents/xlsx";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Export mensuel multi-freelances (CRA soumis et validés), dans le périmètre de l'utilisateur. */
export async function GET(request: Request) {
  const user = await authorize(["MANAGER", "ADMIN", "FINANCE"]);
  if (user instanceof Response) return user;
  const m = new URL(request.url).searchParams.get("mois")?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return new Response("Paramètre mois=AAAA-MM attendu", { status: 400 });
  const year = Number(m[1]);
  const month1 = Number(m[2]);

  let docs = await loadMonthDocuments(user, year, month1);
  const unsealed = docs.filter((d) => !d.authCode);
  if (unsealed.length > 0) {
    for (const d of unsealed) await db.$transaction((tx) => sealTimesheet(tx, d.id, { onlyIfUnsealed: true }));
    docs = await loadMonthDocuments(user, year, month1);
  }

  const book = await monthlyWorkbook(docs);
  await db.auditLog.create({
    data: { actorId: user.id, entity: "Export", entityId: `${m[1]}-${m[2]}`, action: "MONTHLY_XLSX", payload: { count: docs.length } },
  });
  return fileResponse(book, XLSX, fileName("CRA", m[1], m[2], "export") + ".xlsx", "attachment");
}
