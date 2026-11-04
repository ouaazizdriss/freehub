import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isStorageKey } from "./storage-keys";

/**
 * Stockage privé des fichiers (signatures, pièces justificatives).
 * Implémentation locale (dossier hors de `public/`, jamais servi directement) ;
 * l'interface put/get/remove permet de basculer vers S3 / Azure Blob sans toucher aux appelants.
 * Les clés sont générées ici (préfixe + UUID) : aucun nom de fichier fourni par l'utilisateur
 * n'entre dans un chemin.
 */
// Racine résolue à l'exécution : exclue du traçage de fichiers du build (sinon tout le projet est embarqué).
const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.STORAGE_DIR ?? "storage");

function resolve(key: string): string {
  if (!isStorageKey(key)) throw new Error("Clé de stockage invalide");
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Clé de stockage invalide");
  return full;
}

export function newKey(prefix: "signatures" | "documents", ext: "png" | "pdf" | "jpg"): string {
  return `${prefix}/${randomUUID()}.${ext}`;
}

export async function putFile(key: string, data: Buffer): Promise<void> {
  const full = resolve(key);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await writeFile(full, data, { mode: 0o600, flag: "wx" });
}

export async function getFile(key: string): Promise<Buffer | null> {
  try {
    return await readFile(resolve(key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export async function removeFile(key: string): Promise<void> {
  await rm(resolve(key), { force: true });
}
