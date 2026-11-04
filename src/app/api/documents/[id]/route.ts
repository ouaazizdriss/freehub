import { db } from "@/lib/db";
import { authorize, fileName } from "@/lib/documents/http";
import { freelancerScope } from "@/lib/queries/referential";
import { getFile } from "@/lib/storage";

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);

/** Téléchargement d'une pièce justificative : le freelance titulaire, l'admin, ou un manager de son périmètre. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorize(["FREELANCE", "MANAGER", "ADMIN"], request);
  if (user instanceof Response) return user;
  const { id } = await params;
  const doc = await db.freelancerDocument.findFirst({
    where: { id, freelancer: user.role === "FREELANCE" ? { userId: user.id } : freelancerScope(user) },
    select: { fileKey: true, fileName: true, mimeType: true },
  });
  const file = doc?.fileKey ? await getFile(doc.fileKey) : null;
  if (!doc || !file || !doc.mimeType || !ALLOWED.has(doc.mimeType)) return new Response("Document introuvable", { status: 404 });
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": doc.mimeType,
      // Toujours en pièce jointe : un fichier déposé n'est jamais rendu dans l'origine de l'application.
      "Content-Disposition": `attachment; filename="${fileName(doc.fileName ?? "document")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
