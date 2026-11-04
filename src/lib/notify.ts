import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Notifications e-mail.
 * - SMTP_URL défini (ex. smtps://user:pass@smtp.example.com:465) : envoi réel ;
 * - sinon : le message est journalisé (dev, CI) — aucune erreur.
 * Un échec d'envoi n'annule jamais l'action métier : il est journalisé.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  transporter ??= process.env.SMTP_URL
    ? nodemailer.createTransport(process.env.SMTP_URL, {
        // Délais courts : un SMTP qui ne répond pas ne doit pas retenir le serveur.
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
      })
    : nodemailer.createTransport({ jsonTransport: true });
  return transporter;
}

export function appUrl(path = "/") {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}

/** Retire les retours à la ligne d'un en-tête (anti-injection d'en-têtes). */
const header = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export type Mail = { to: string; subject: string; text: string };

export async function sendMail(mail: Mail): Promise<boolean> {
  try {
    const info = await getTransporter().sendMail({
      from: process.env.MAIL_FROM ?? "Freelance Hub <no-reply@freelancehub.local>",
      to: header(mail.to),
      subject: header(mail.subject),
      text: mail.text,
    });
    if (!process.env.SMTP_URL) console.info(`[mail] ${header(mail.subject)} → ${header(mail.to)}`, info.messageId ?? "");
    return true;
  } catch (e) {
    console.error("[mail] échec d'envoi", header(mail.subject), e instanceof Error ? e.message : e);
    return false;
  }
}

// ---------- Modèles de messages ----------

export function timesheetValidatedMail(p: { to: string; name: string; month: string; mission: string; decidedBy: string }): Mail {
  return {
    to: p.to,
    subject: `CRA ${p.month} validé`,
    text: `Bonjour ${p.name},\n\nVotre CRA de ${p.month} (${p.mission}) a été validé par ${p.decidedBy}.\nConsultez-le dans Freelance Hub : ${appUrl("/cra")}\n\n— Freelance Hub`,
  };
}

export function timesheetRejectedMail(p: { to: string; name: string; month: string; mission: string; reason: string; decidedBy: string }): Mail {
  return {
    to: p.to,
    subject: `CRA ${p.month} : correction demandée`,
    text: `Bonjour ${p.name},\n\n${p.decidedBy} demande une correction de votre CRA de ${p.month} (${p.mission}) :\n\n« ${p.reason} »\n\nCorrigez puis soumettez à nouveau : ${appUrl("/cra")}\n\n— Freelance Hub`,
  };
}

export function timesheetSubmittedMail(p: { to: string; managerName: string; freelancer: string; month: string; mission: string }): Mail {
  return {
    to: p.to,
    subject: `CRA ${p.month} de ${p.freelancer} à valider`,
    text: `Bonjour ${p.managerName},\n\n${p.freelancer} a soumis son CRA de ${p.month} (${p.mission}).\nFile de validation : ${appUrl("/validation")}\n\n— Freelance Hub`,
  };
}

export function reminderMail(p: { to: string; name: string; month: string; deadline: string; kind: "J-3" | "LATE" }): Mail {
  return p.kind === "J-3"
    ? {
        to: p.to,
        subject: `Rappel : CRA ${p.month} à déposer avant le ${p.deadline}`,
        text: `Bonjour ${p.name},\n\nVotre CRA de ${p.month} est à déposer avant le ${p.deadline}.\nSaisir et soumettre : ${appUrl("/cra")}\n\n— Freelance Hub`,
      }
    : {
        to: p.to,
        subject: `CRA ${p.month} en retard`,
        text: `Bonjour ${p.name},\n\nL'échéance du ${p.deadline} est passée et votre CRA de ${p.month} n'a pas été soumis.\nMerci de le déposer au plus vite : ${appUrl("/cra")}\n\n— Freelance Hub`,
      };
}
