/**
 * Purge de rétention RGPD — à planifier (mensuel). Simulation par défaut :
 *   npm run retention            # simulation : affiche ce qui serait supprimé ou anonymisé
 *   npm run retention -- --apply # exécution
 * Durées : cf. docs/RGPD.md. Les CRA validés sont verrouillés en base ; la purge active
 * `app.retention_purge` pour sa seule transaction (seule exception prévue par les triggers).
 */
import "dotenv/config";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

export const RETENTION = {
  /**
   * CRA, jours, totaux : pièces justificatives comptables — Code de commerce L123-22 : 10 ans à compter
   * de la clôture de l'exercice (exercice calendaire par défaut, cf. FISCAL_YEAR_END_MONTH).
   */
  timesheetYears: 10,
  /** Journal d'audit des transitions : conservé avec les CRA */
  auditYears: 10,
  /** Traces de téléchargement et relances : 1 an */
  downloadLogMonths: 12,
  /** Absences : 3 ans après leur fin */
  absenceYears: 3,
  /** Pièces justificatives (vigilance URSSAF) : 5 ans après expiration */
  documentYearsAfterExpiry: 5,
  /** Comptes désactivés sans contrat depuis 3 ans : anonymisés */
  inactiveAccountYears: 3,
};

const apply = process.argv.includes("--apply");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const STORAGE = path.resolve(process.env.STORAGE_DIR ?? "storage");

/** Mois de clôture de l'exercice (1–12), décembre par défaut. */
const FISCAL_YEAR_END_MONTH = Number(process.env.FISCAL_YEAR_END_MONTH ?? 12);

/**
 * Premier jour des données encore à conserver : les exercices clos depuis plus de `years` ans peuvent
 * être purgés. Ex. (exercice calendaire) le 5/11/2036, l'exercice 2026 (clos le 31/12/2026) est conservé.
 */
function fiscalCutoff(years: number): Date {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  // Fin du dernier exercice clos depuis au moins `years` ans
  const lastClosedEndYear = m > FISCAL_YEAR_END_MONTH ? y - years : y - years - 1;
  return new Date(Date.UTC(lastClosedEndYear, FISCAL_YEAR_END_MONTH, 1));
}

const ago = (years: number, months = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years, d.getUTCMonth() - months);
  return d;
};

async function main() {
  const report: Record<string, number> = {};
  const timesheetCutoff = fiscalCutoff(RETENTION.timesheetYears);
  const auditCutoff = fiscalCutoff(RETENTION.auditYears);
  const downloadCutoff = ago(0, RETENTION.downloadLogMonths);
  const documentCutoff = ago(RETENTION.documentYearsAfterExpiry);
  const accountCutoff = ago(RETENTION.inactiveAccountYears);

  const oldTimesheets = await db.timesheet.findMany({ where: { month: { lt: timesheetCutoff } }, select: { id: true } });
  // Pièces : expirées depuis 5 ans, ou sans expiration (Kbis) déposées depuis 5 ans.
  const documentWhere = {
    OR: [{ expiresAt: { lt: documentCutoff } }, { expiresAt: null, uploadedAt: { lt: documentCutoff } }],
  };
  const oldDocuments = await db.freelancerDocument.findMany({ where: documentWhere, select: { id: true, fileKey: true } });
  // Comptes désactivés depuis 3 ans ET sans contrat terminé depuis moins de 3 ans.
  const inactiveWhere = {
    user: { active: false, deactivatedAt: { lt: accountCutoff }, email: { not: { endsWith: "@anonyme.invalid" } } },
    contracts: { none: { endDate: { gte: accountCutoff } } },
  };
  const inactive = await db.freelancer.findMany({ where: inactiveWhere, select: { id: true } });

  report["CRA de plus de 10 ans"] = oldTimesheets.length;
  report["Journal d'audit de plus de 10 ans"] = await db.auditLog.count({ where: { createdAt: { lt: auditCutoff } } });
  report["Traces de téléchargement de plus d'un an"] = await db.auditLog.count({
    where: { createdAt: { lt: downloadCutoff }, action: { in: ["PDF_DOWNLOAD", "XLSX_DOWNLOAD", "MONTHLY_XLSX"] } },
  });
  report["Relances de plus d'un an"] = await db.reminderLog.count({ where: { sentAt: { lt: downloadCutoff } } });
  report["Absences terminées depuis plus de 3 ans"] = await db.absence.count({ where: { endDate: { lt: ago(RETENTION.absenceYears) } } });
  report["Pièces expirées depuis plus de 5 ans"] = oldDocuments.length;
  report["Comptes désactivés à anonymiser"] = inactive.length;

  // Fichiers orphelins (signatures remplacées jamais figées, pièces dont la ligne a disparu)
  const orphans = await orphanFiles();
  report["Fichiers orphelins (signatures, pièces)"] = orphans.length;

  console.table(report);
  if (!apply) {
    console.log("Simulation : rien n'a été modifié. Relancer avec --apply pour exécuter.");
    return;
  }

  const filesToRemove: string[] = [];
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.retention_purge', 'on', true)`;
    await tx.timesheetDay.deleteMany({ where: { timesheetId: { in: oldTimesheets.map((t) => t.id) } } });
    await tx.timesheet.deleteMany({ where: { id: { in: oldTimesheets.map((t) => t.id) } } });
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { createdAt: { lt: auditCutoff } },
          { createdAt: { lt: downloadCutoff }, action: { in: ["PDF_DOWNLOAD", "XLSX_DOWNLOAD", "MONTHLY_XLSX"] } },
        ],
      },
    });
    await tx.reminderLog.deleteMany({ where: { sentAt: { lt: downloadCutoff } } });
    await tx.absence.deleteMany({ where: { endDate: { lt: ago(RETENTION.absenceYears) } } });
    const documents = await tx.freelancerDocument.findMany({ where: documentWhere, select: { id: true, fileKey: true } });
    await tx.freelancerDocument.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });
    filesToRemove.push(...documents.flatMap((d) => (d.fileKey ? [d.fileKey] : [])));

    // Conditions relues dans la transaction : un compte réactivé entre-temps n'est pas anonymisé.
    for (const f of await tx.freelancer.findMany({ where: inactiveWhere, select: { id: true, userId: true } })) {
      // Les CRA conservés gardent leur instantané (noms figés à la soumission).
      await tx.user.update({ where: { id: f.userId }, data: { name: "Ancien freelance", email: `anonyme+${f.userId}@anonyme.invalid` } });
      await tx.freelancer.update({ where: { id: f.id }, data: { company: null, siret: null, jobTitle: "—" } });
      await tx.absence.updateMany({ where: { freelancerId: f.id }, data: { comment: null } });
      const signature = await tx.signature.findUnique({ where: { freelancerId: f.id }, select: { fileKey: true } });
      await tx.signature.deleteMany({ where: { freelancerId: f.id } });
      // Fichier supprimé seulement s'il n'est figé sur aucun CRA conservé.
      if (signature && (await tx.timesheet.count({ where: { signatureKey: signature.fileKey } })) === 0) filesToRemove.push(signature.fileKey);
      const docs = await tx.freelancerDocument.findMany({ where: { freelancerId: f.id }, select: { fileKey: true } });
      await tx.freelancerDocument.deleteMany({ where: { freelancerId: f.id } });
      filesToRemove.push(...docs.flatMap((d) => (d.fileKey ? [d.fileKey] : [])));
    }
  });
  // Après validation en base ; un échec de suppression est rattrapé au prochain passage (fichiers orphelins).
  for (const key of [...filesToRemove, ...orphans]) await rm(path.join(STORAGE, key), { force: true });
  console.log("Purge appliquée.");
}

/** Fichiers du stockage qu'aucune ligne ne référence (délai de grâce de 24 h pour les dépôts en cours). */
async function orphanFiles(): Promise<string[]> {
  const referenced = new Set<string>([
    ...(await db.signature.findMany({ select: { fileKey: true } })).map((s) => s.fileKey),
    ...(await db.timesheet.findMany({ where: { signatureKey: { not: null } }, select: { signatureKey: true } })).map((t) => t.signatureKey!),
    ...(await db.freelancerDocument.findMany({ where: { fileKey: { not: null } }, select: { fileKey: true } })).map((d) => d.fileKey!),
  ]);
  const orphans: string[] = [];
  for (const folder of ["signatures", "documents"]) {
    const dir = path.join(STORAGE, folder);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const key = `${folder}/${name}`;
      if (!referenced.has(key) && (await stat(path.join(dir, name))).mtimeMs < Date.now() - 86_400_000) orphans.push(key);
    }
  }
  return orphans;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
