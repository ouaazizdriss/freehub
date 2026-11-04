import { db } from "@/lib/db";
import { authorize } from "@/lib/documents/http";
import { getFile } from "@/lib/storage";

/** Signature du freelance connecté (aperçu dans l'écran de saisie). Jamais celle d'un autre. */
export async function GET(request: Request) {
  const user = await authorize(["FREELANCE"], request);
  if (user instanceof Response) return user;
  const signature = await db.signature.findFirst({ where: { freelancer: { userId: user.id } }, select: { fileKey: true } });
  const file = signature ? await getFile(signature.fileKey) : null;
  if (!file) return new Response("Aucune signature", { status: 404 });
  return new Response(new Uint8Array(file), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
