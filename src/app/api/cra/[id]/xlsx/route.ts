import { authorize, documentFor, fileName, fileResponse, logDownload } from "@/lib/documents/http";
import { timesheetWorkbook } from "@/lib/documents/xlsx";
import { limited, tooManyRequests } from "@/lib/rate-limit";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Export Excel d'un CRA (détail par jour + synthèse). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorize(undefined, request);
  if (user instanceof Response) return user;
  if (await limited("xlsx", user.id)) return tooManyRequests();
  const { id } = await params;
  const doc = await documentFor(user, id);
  if (!doc) return new Response("CRA introuvable", { status: 404 });

  const book = await timesheetWorkbook(doc);
  await logDownload(user, doc.id, "XLSX_DOWNLOAD");
  const name = fileName("CRA", `${doc.year}-${String(doc.month1).padStart(2, "0")}`, doc.freelancerName) + ".xlsx";
  return fileResponse(book, XLSX, name, "attachment");
}
