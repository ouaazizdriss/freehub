"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireRole, type CurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { newKey, putFile, removeFile } from "@/lib/storage";
import { REFERENTIAL_EDITORS } from "@/lib/queries/referential";

/** État renvoyé aux formulaires (useActionState). */
export type FormState = { ok: boolean; message: string; errors?: Record<string, string>; id?: string } | null;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");
const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));
/** Montant saisi en euros (virgule ou point décimal) → centimes entiers. */
const euros = z
  .string()
  .trim()
  .transform((v) => (v === "" ? NaN : Number(v.replace(/\s/g, "").replace(",", "."))))
  .refine((v) => Number.isFinite(v) && v >= 0 && v <= 100_000, "Montant invalide (0 à 100 000)")
  .transform((v) => Math.round(v * 100));

function fail(error: z.ZodError): FormState {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return { ok: false, message: "Vérifiez les champs signalés.", errors };
}

/** Erreurs Prisma attendues → message de formulaire (au lieu de faire planter la page). */
function unique(e: unknown, message: string): FormState | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (e.code === "P2002") return { ok: false, message };
  if (e.code === "P2025" || e.code === "P2003") return { ok: false, message: "Enregistrement introuvable : rechargez la page." };
  return null;
}

/** Sérialise les écritures de contrats d'un freelance sur une mission (contrôle de chevauchement fiable). */
async function lockContracts(tx: Prisma.TransactionClient, freelancerId: string, missionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contract:${freelancerId}:${missionId}`}))`;
}

async function audit(user: CurrentUser, entity: string, entityId: string, action: string, payload?: Prisma.InputJsonValue) {
  await db.auditLog.create({ data: { actorId: user.id, entity, entityId, action, payload } });
}

const fields = (data: FormData) => Object.fromEntries([...data.entries()].filter(([, v]) => typeof v === "string"));

// ---------- Freelances ----------

const freelancerSchema = z.object({
  name: text(120).min(2, "Nom obligatoire"),
  email: z
    .email("E-mail invalide")
    .max(200)
    .transform((v) => v.toLowerCase()),
  jobTitle: text(120).min(2, "Intitulé du poste obligatoire"),
  company: optional(160),
  siret: optional(14).refine((v) => v === null || /^\d{14}$/.test(v), "SIRET : 14 chiffres"),
});

export async function createFreelancer(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(REFERENTIAL_EDITORS);
  const parsed = freelancerSchema.safeParse(fields(data));
  if (!parsed.success) return fail(parsed.error);
  const { name, email, ...profile } = parsed.data;
  try {
    const created = await db.user.create({
      data: { name, email, role: "FREELANCE", freelancer: { create: profile } },
      select: { freelancer: { select: { id: true } } },
    });
    const id = created.freelancer!.id;
    await audit(user, "Freelancer", id, "CREATE", { email });
    refresh();
    return { ok: true, message: "Freelance créé. Ajoutez maintenant son contrat.", id };
  } catch (e) {
    const known = unique(e, "Un compte existe déjà avec cet e-mail.");
    if (known) return known;
    throw e;
  }
}

export async function updateFreelancer(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(REFERENTIAL_EDITORS);
  const id = z.string().min(1).safeParse(data.get("id"));
  const parsed = freelancerSchema.safeParse(fields(data));
  if (!id.success) return { ok: false, message: "Freelance introuvable." };
  if (!parsed.success) return fail(parsed.error);
  const { name, email, ...profile } = parsed.data;
  try {
    await db.freelancer.update({ where: { id: id.data }, data: { ...profile, user: { update: { name, email } } } });
    await audit(user, "Freelancer", id.data, "UPDATE");
    refresh();
    return { ok: true, message: "Fiche enregistrée." };
  } catch (e) {
    const known = unique(e, "Un compte existe déjà avec cet e-mail.");
    if (known) return known;
    throw e;
  }
}

/** Désactivation (départ) : le compte ne peut plus se connecter ; l'historique est conservé. */
export async function setFreelancerActive(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(REFERENTIAL_EDITORS);
  const parsed = z.object({ id: z.string().min(1), active: z.enum(["true", "false"]) }).safeParse(fields(data));
  if (!parsed.success) return { ok: false, message: "Requête invalide." };
  const active = parsed.data.active === "true";
  try {
    await db.freelancer.update({
      where: { id: parsed.data.id },
      data: { user: { update: { active, deactivatedAt: active ? null : new Date() } } },
    });
  } catch (e) {
    const known = unique(e, "");
    if (known) return known;
    throw e;
  }
  await audit(user, "Freelancer", parsed.data.id, active ? "ACTIVATE" : "DEACTIVATE");
  refresh();
  return { ok: true, message: active ? "Compte réactivé." : "Compte désactivé." };
}

// ---------- Missions et bons de commande ----------

const missionSchema = z
  .object({
    name: text(120).min(2, "Nom obligatoire"),
    managerId: z.string().min(1, "Manager obligatoire"),
    country: z.enum(["MA", "FR"], "Pays non géré"),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((m) => m.endDate >= m.startDate, { path: ["endDate"], message: "La fin précède le début" });

export async function createMission(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(REFERENTIAL_EDITORS);
  const parsed = missionSchema.safeParse(fields(data));
  if (!parsed.success) return fail(parsed.error);
  const manager = await db.user.findFirst({
    where: { id: parsed.data.managerId, role: "MANAGER", active: true },
    select: { id: true },
  });
  if (!manager) return { ok: false, message: "Manager introuvable.", errors: { managerId: "Manager introuvable" } };
  const m = parsed.data;
  const mission = await db.mission.create({
    data: {
      name: m.name,
      managerId: m.managerId,
      country: m.country,
      startDate: new Date(`${m.startDate}T00:00:00Z`),
      endDate: new Date(`${m.endDate}T00:00:00Z`),
    },
    select: { id: true },
  });
  await audit(user, "Mission", mission.id, "CREATE");
  refresh();
  return { ok: true, message: "Mission créée." };
}

const poSchema = z
  .object({
    missionId: z.string().min(1),
    number: text(40).regex(/^[A-Za-z0-9][A-Za-z0-9-_/]*$/, "Numéro : lettres, chiffres, - _ /"),
    budgetDays: z.coerce.number().positive("Budget > 0").max(10_000, "Budget trop élevé").multipleOf(0.5, "Par demi-journée"),
    currency: z.enum(["EUR", "MAD"], "Devise non gérée"),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((p) => p.endDate >= p.startDate, { path: ["endDate"], message: "La fin précède le début" });

export async function createPurchaseOrder(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(REFERENTIAL_EDITORS);
  const parsed = poSchema.safeParse(fields(data));
  if (!parsed.success) return fail(parsed.error);
  const p = parsed.data;
  const mission = await db.mission.findUnique({ where: { id: p.missionId }, select: { startDate: true, endDate: true } });
  if (!mission) return { ok: false, message: "Mission introuvable." };
  if (p.startDate < mission.startDate.toISOString().slice(0, 10) || p.endDate > mission.endDate.toISOString().slice(0, 10)) {
    return {
      ok: false,
      message: "Le bon de commande doit être compris dans les dates de la mission.",
      errors: { endDate: "Hors mission" },
    };
  }
  try {
    const po = await db.purchaseOrder.create({
      data: {
        missionId: p.missionId,
        number: p.number.toUpperCase(),
        budgetHalfDays: Math.round(p.budgetDays * 2),
        currency: p.currency,
        startDate: new Date(`${p.startDate}T00:00:00Z`),
        endDate: new Date(`${p.endDate}T00:00:00Z`),
      },
      select: { id: true },
    });
    await audit(user, "PurchaseOrder", po.id, "CREATE");
    refresh();
    return { ok: true, message: "Bon de commande créé." };
  } catch (e) {
    const known = unique(e, "Ce numéro de bon de commande existe déjà.");
    if (known) return known;
    throw e;
  }
}

// ---------- Contrats ----------

const contractSchema = z
  .object({
    freelancerId: z.string().min(1),
    missionId: z.string().min(1, "Mission obligatoire"),
    dailyRate: euros.refine((v) => v > 0, "TJM obligatoire"),
    overtimeRate: euros,
    onCallRate: euros,
    currency: z.enum(["EUR", "MAD"], "Devise non gérée"),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((c) => c.endDate >= c.startDate, { path: ["endDate"], message: "La fin précède le début" });

export async function createContract(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(REFERENTIAL_EDITORS);
  const parsed = contractSchema.safeParse(fields(data));
  if (!parsed.success) return fail(parsed.error);
  const c = parsed.data;
  const [mission, freelancer] = await Promise.all([
    db.mission.findUnique({
      where: { id: c.missionId },
      select: { startDate: true, endDate: true, purchaseOrders: { select: { currency: true } } },
    }),
    db.freelancer.findUnique({ where: { id: c.freelancerId }, select: { id: true } }),
  ]);
  if (!mission || !freelancer) return { ok: false, message: "Mission ou freelance introuvable." };
  if (c.startDate < mission.startDate.toISOString().slice(0, 10) || c.endDate > mission.endDate.toISOString().slice(0, 10)) {
    return {
      ok: false,
      message: "Le contrat doit être compris dans les dates de la mission.",
      errors: { endDate: "Hors mission" },
    };
  }
  if (mission.purchaseOrders.some((p) => p.currency !== c.currency)) {
    return {
      ok: false,
      message: "La devise du contrat doit être celle des bons de commande de la mission.",
      errors: { currency: "Devise différente du PO" },
    };
  }
  const start = new Date(`${c.startDate}T00:00:00Z`);
  const end = new Date(`${c.endDate}T00:00:00Z`);
  const contract = await db.$transaction(async (tx) => {
    await lockContracts(tx, c.freelancerId, c.missionId);
    const overlap = await tx.contract.count({
      where: { freelancerId: c.freelancerId, missionId: c.missionId, startDate: { lte: end }, endDate: { gte: start } },
    });
    if (overlap > 0) return null;
    return tx.contract.create({
      data: {
        freelancerId: c.freelancerId,
        missionId: c.missionId,
        dailyRateCents: c.dailyRate,
        overtimeHourlyRateCents: c.overtimeRate,
        onCallRateCents: c.onCallRate,
        currency: c.currency,
        startDate: start,
        endDate: end,
      },
      select: { id: true },
    });
  });
  if (!contract) return { ok: false, message: "Un contrat couvre déjà tout ou partie de cette période sur cette mission." };
  await audit(user, "Contract", contract.id, "CREATE", { dailyRateCents: c.dailyRate });
  refresh();
  return { ok: true, message: "Contrat créé." };
}

/**
 * Modification d'un contrat : la date de fin (prolongation, fin anticipée) reste modifiable ;
 * les taux ne le sont plus dès qu'un CRA a été soumis sur ce contrat (créer un avenant = nouveau contrat).
 */
export async function updateContract(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(REFERENTIAL_EDITORS);
  const parsed = z
    .object({ id: z.string().min(1), endDate: isoDate, dailyRate: euros, overtimeRate: euros, onCallRate: euros })
    .safeParse(fields(data));
  if (!parsed.success) return fail(parsed.error);
  const c = parsed.data;
  const contract = await db.contract.findUnique({
    where: { id: c.id },
    select: {
      freelancerId: true,
      missionId: true,
      startDate: true,
      dailyRateCents: true,
      overtimeHourlyRateCents: true,
      onCallRateCents: true,
      mission: { select: { endDate: true } },
      _count: { select: { timesheets: { where: { status: { in: ["SUBMITTED", "VALIDATED"] } } } } },
    },
  });
  if (!contract) return { ok: false, message: "Contrat introuvable." };
  if (c.endDate < contract.startDate.toISOString().slice(0, 10))
    return { ok: false, message: "La fin précède le début.", errors: { endDate: "Avant le début" } };
  if (c.endDate > contract.mission.endDate.toISOString().slice(0, 10))
    return { ok: false, message: "Au-delà de la fin de mission.", errors: { endDate: "Hors mission" } };
  const ratesChanged =
    c.dailyRate !== contract.dailyRateCents ||
    c.overtimeRate !== contract.overtimeHourlyRateCents ||
    c.onCallRate !== contract.onCallRateCents;
  if (ratesChanged && contract._count.timesheets > 0) {
    return {
      ok: false,
      message: "Des CRA ont été soumis sur ce contrat : créez un nouveau contrat (avenant) pour changer les taux.",
    };
  }
  if (c.dailyRate <= 0) return { ok: false, message: "TJM obligatoire.", errors: { dailyRate: "TJM obligatoire" } };
  const end = new Date(`${c.endDate}T00:00:00Z`);
  const problem = await db.$transaction(async (tx) => {
    await lockContracts(tx, contract.freelancerId, contract.missionId);
    // Prolongation : pas de chevauchement avec un autre contrat de la même mission.
    const overlap = await tx.contract.count({
      where: {
        id: { not: c.id },
        freelancerId: contract.freelancerId,
        missionId: contract.missionId,
        startDate: { lte: end },
        endDate: { gte: contract.startDate },
      },
    });
    if (overlap > 0) return "Cette date ferait chevaucher un autre contrat sur la même mission.";
    // Fin anticipée : pas avant un mois déjà soumis ou validé.
    const lastSubmitted = await tx.timesheet.findFirst({
      where: { contractId: c.id, status: { in: ["SUBMITTED", "VALIDATED"] } },
      orderBy: { month: "desc" },
      select: { month: true },
    });
    if (lastSubmitted && end < lastSubmitted.month)
      return "Un CRA a été soumis après cette date : la fin du contrat ne peut pas être avancée avant.";
    await tx.contract.update({
      where: { id: c.id },
      data: { endDate: end, dailyRateCents: c.dailyRate, overtimeHourlyRateCents: c.overtimeRate, onCallRateCents: c.onCallRate },
    });
    return null;
  });
  if (problem) return { ok: false, message: problem, errors: { endDate: problem } };
  await audit(user, "Contract", c.id, "UPDATE", { endDate: c.endDate, ratesChanged });
  refresh();
  return { ok: true, message: "Contrat enregistré." };
}

// ---------- Pièces justificatives ----------

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** Type réel d'après les premiers octets (le type déclaré par le navigateur n'est pas fiable). */
function sniff(bytes: Buffer): { mime: string; ext: "pdf" | "png" | "jpg" } | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

/**
 * Validité maximale crédible par type de pièce (en mois à compter du dépôt) : un freelance ne peut
 * pas se mettre « en règle » avec une date fantaisiste. Expiration obligatoire sauf Kbis.
 */
const MAX_VALIDITY_MONTHS = { URSSAF: 6, INSURANCE: 13, KBIS: 12, OTHER: 60 } as const;
const UPLOADS_PER_HOUR = 20;

const documentSchema = z
  .object({
    freelancerId: z.string().min(1).optional(),
    kind: z.enum(["URSSAF", "INSURANCE", "KBIS", "OTHER"], "Type de pièce invalide"),
    expiresAt: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Date invalide"),
  })
  .superRefine((d, ctx) => {
    if (d.expiresAt === null) {
      if (d.kind === "URSSAF" || d.kind === "INSURANCE")
        ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Date d'expiration obligatoire" });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const max = new Date();
    max.setUTCMonth(max.getUTCMonth() + MAX_VALIDITY_MONTHS[d.kind]);
    if (d.expiresAt < today) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Pièce déjà expirée" });
    else if (d.expiresAt > max.toISOString().slice(0, 10)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: `Validité max. ${MAX_VALIDITY_MONTHS[d.kind]} mois pour ce type de pièce`,
      });
    }
  });

/** Dépôt d'une pièce : par le freelance pour lui-même, ou par l'admin pour n'importe quel freelance. */
export async function uploadDocument(_prev: FormState, data: FormData): Promise<FormState> {
  const user = await requireRole(["FREELANCE", "ADMIN"]);
  const parsed = documentSchema.safeParse(fields(data));
  if (!parsed.success) return fail(parsed.error);
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: "Choisissez un fichier.", errors: { file: "Fichier obligatoire" } };
  if (file.size > MAX_DOCUMENT_BYTES)
    return { ok: false, message: "Fichier trop lourd (4 Mo maximum).", errors: { file: "4 Mo maximum" } };

  const freelancer =
    user.role === "FREELANCE"
      ? await db.freelancer.findUnique({ where: { userId: user.id }, select: { id: true } })
      : await db.freelancer.findUnique({ where: { id: parsed.data.freelancerId ?? "" }, select: { id: true } });
  if (!freelancer) return { ok: false, message: "Freelance introuvable." };

  const recent = await db.freelancerDocument.count({
    where: { uploadedById: user.id, uploadedAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recent >= UPLOADS_PER_HOUR) return { ok: false, message: "Trop de dépôts en une heure : réessayez plus tard." };

  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) return { ok: false, message: "Formats acceptés : PDF, PNG, JPG.", errors: { file: "PDF, PNG ou JPG" } };

  const key = newKey("documents", type.ext);
  await putFile(key, bytes);
  const safeName =
    file.name
      .normalize("NFC")
      .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
      .slice(0, 120) || `document.${type.ext}`;
  const doc = await db.freelancerDocument
    .create({
      data: {
        freelancerId: freelancer.id,
        kind: parsed.data.kind,
        expiresAt: parsed.data.expiresAt ? new Date(`${parsed.data.expiresAt}T00:00:00Z`) : null,
        fileKey: key,
        fileName: safeName,
        mimeType: type.mime,
        sizeBytes: bytes.length,
        uploadedById: user.id,
      },
      select: { id: true },
    })
    .catch(async (e) => {
      await removeFile(key); // pas de fichier orphelin si l'enregistrement échoue
      throw e;
    });
  await audit(user, "FreelancerDocument", doc.id, "UPLOAD", { kind: parsed.data.kind });
  refresh();
  return { ok: true, message: "Pièce enregistrée." };
}
