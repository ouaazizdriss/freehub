"use server";

import { refresh } from "next/cache";
import sharp from "sharp";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { newKey, putFile } from "@/lib/storage";

export type SignatureResult = { ok: true } | { ok: false; message: string };

const MAX_SIGNATURE_BYTES = 1024 * 1024;

/**
 * Dépôt de la signature du freelance (PNG/JPG ≤ 1 Mo).
 * Le format est vérifié sur le contenu (pas sur l'extension ni le type MIME déclaré), l'image est
 * réencodée en PNG (supprime métadonnées et contenu parasite), rognée de ses marges blanches et
 * réduite. La signature est réutilisée d'un mois sur l'autre.
 */
export async function uploadSignature(formData: FormData): Promise<SignatureResult> {
  const user = await requireRole(["FREELANCE"]);
  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choisissez une image." };
  if (file.size > MAX_SIGNATURE_BYTES) return { ok: false, message: "Image trop lourde (1 Mo maximum)." };

  const input = Buffer.from(await file.arrayBuffer());
  let png: Buffer;
  try {
    const image = sharp(input, { limitInputPixels: 16_000_000, failOn: "error" });
    const meta = await image.metadata();
    if (meta.format !== "png" && meta.format !== "jpeg") return { ok: false, message: "Format accepté : PNG ou JPG." };
    png = await image
      .rotate()
      .trim({ threshold: 25 })
      .resize({ width: 600, height: 240, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return { ok: false, message: "Image illisible. Utilisez un PNG ou un JPG." };
  }

  const freelancer = await db.freelancer.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!freelancer) return { ok: false, message: "Fiche freelance introuvable." };

  const key = newKey("signatures", "png");
  await putFile(key, png);
  // L'ancienne image n'est jamais supprimée ici : un CRA soumis peut l'avoir figée (y compris une
  // soumission en cours, non encore validée en base). Le nettoyage des images orphelines relève
  // de la tâche de rétention (Lot 6).
  await db.$transaction(async (tx) => {
    await tx.signature.upsert({
      where: { freelancerId: freelancer.id },
      create: { freelancerId: freelancer.id, fileKey: key, mimeType: "image/png" },
      update: { fileKey: key, mimeType: "image/png", uploadedAt: new Date() },
    });
    await tx.auditLog.create({ data: { actorId: user.id, entity: "Signature", entityId: freelancer.id, action: "UPLOAD" } });
  });
  refresh();
  return { ok: true };
}
