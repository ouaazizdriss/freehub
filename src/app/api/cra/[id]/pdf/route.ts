import { authorize, documentFor, fileName, fileResponse, logDownload } from "@/lib/documents/http";
import { renderTimesheetPdf } from "@/lib/documents/pdf";

/** PDF officiel d'un CRA (aperçu inline ; ?telecharger=1 pour un téléchargement). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorize();
  if (user instanceof Response) return user;
  const { id } = await params;
  const doc = await documentFor(user, id);
  if (!doc) return new Response("CRA introuvable", { status: 404 });

  const pdf = await renderTimesheetPdf(doc);
  await logDownload(user, doc.id, "PDF_DOWNLOAD");
  const name = fileName("CRA", `${doc.year}-${String(doc.month1).padStart(2, "0")}`, doc.freelancerName) + ".pdf";
  const download = new URL(request.url).searchParams.has("telecharger");
  return fileResponse(pdf, "application/pdf", name, download ? "attachment" : "inline");
}
