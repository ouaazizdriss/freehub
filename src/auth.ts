import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { z } from "zod";
import { db } from "@/lib/db";
import { tenantFromIssuer, trustedIdentity } from "@/lib/auth/entra";
import { sendMail } from "@/lib/notify";
import { clientIp, limited } from "@/lib/rate-limit";
import { maskEmail, securityEvent } from "@/lib/security-log";

/**
 * Connexion de démo (sélection d'un compte seedé, sans mot de passe).
 * Jamais disponible en production, même si AUTH_DEV_LOGIN=true.
 */
export const ssoEnabled = Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
const localUrl = !process.env.APP_URL || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(process.env.APP_URL);
/**
 * Connexion de démo : jamais en production, jamais si le SSO est configuré, jamais si l'URL publique
 * n'est pas locale (un environnement partagé lancé en mode dev ne doit pas l'exposer).
 */
export const devLoginEnabled =
  process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "true" && !ssoEnabled && localUrl;
if (devLoginEnabled) console.warn("[auth] Connexion de démo ACTIVE (sans mot de passe) — environnement local uniquement.");

const ENTRA = "microsoft-entra-id";

/**
 * Tenant attendu, extrait de l'émetteur (https://login.microsoftonline.com/<tenant-id>/v2.0).
 * Échec au démarrage si l'émetteur manque ou est multi-tenant (common / organizations / consumers) :
 * sinon n'importe quel compte Microsoft pourrait se présenter avec l'e-mail d'un utilisateur (nOAuth).
 */
function expectedTenant(): string {
  const tenant = tenantFromIssuer(process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER);
  if (!tenant) {
    throw new Error(
      "AUTH_MICROSOFT_ENTRA_ID_ISSUER doit désigner le tenant de l'entreprise : https://login.microsoftonline.com/<tenant-id>/v2.0 " +
        "(les émetteurs common / organizations / consumers sont refusés).",
    );
  }
  return tenant;
}
const tenantId = ssoEnabled ? expectedTenant() : null;

type EntraProfile = { oid?: unknown; tid?: unknown; email?: unknown; idp?: unknown };

/**
 * Compte applicatif correspondant à une identité Entra ID.
 * - Le tenant (`tid`) doit être celui de l'entreprise.
 * - Connexions suivantes : reconnaissance par `oid` (immuable), jamais par l'e-mail.
 * - Première connexion : liaison par l'e-mail d'un compte provisionné qui n'est encore lié à aucune
 *   identité ; la liaison est définitive (un autre `oid` ne pourra plus jamais prendre ce compte).
 */
async function resolveEntraUser(profile: EntraProfile | undefined) {
  const oid = trustedIdentity(profile, tenantId);
  if (!oid) return null;
  // Invités B2B et identités fédérées externes (claim `idp`) : refusés, leurs attributs viennent
  // d'un autre annuaire.
  if (typeof profile?.idp === "string") return null;

  const linked = await db.user.findUnique({ where: { entraOid: oid }, select: { id: true, active: true } });
  if (linked) return linked.active ? linked : null;

  // Première liaison : claim `email` uniquement (pas de repli sur preferred_username, modifiable).
  const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : null;
  if (!email) return null;
  // Liaison atomique : ne réussit que si le compte n'est lié à aucune identité.
  const bound = await db.user.updateMany({ where: { email, entraOid: null, active: true }, data: { entraOid: oid } });
  if (bound.count !== 1) return null;
  const user = await db.user.findUnique({
    where: { entraOid: oid },
    select: { id: true, active: true, name: true, email: true },
  });
  if (user) {
    await securityEvent("SSO_LINK", { actorId: user.id });
    // Le titulaire du compte est prévenu : une liaison qu'il n'a pas faite est visible tout de suite.
    void sendMail({
      to: user.email,
      subject: "Votre compte Freelance Hub a été associé à votre identité Microsoft",
      text: `Bonjour ${user.name},\n\nVotre compte Freelance Hub vient d'être associé à votre identité Microsoft. Si vous n'êtes pas à l'origine de cette connexion, prévenez immédiatement l'administrateur.\n\n— Freelance Hub`,
    });
  }
  return user ? { id: user.id, active: user.active } : null;
}

const providers: NextAuthConfig["providers"] = [];
if (ssoEnabled) providers.push(MicrosoftEntraID);
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Compte de démo",
      credentials: { email: { label: "E-mail", type: "email" } },
      async authorize(raw) {
        if (await limited("login", await clientIp())) return null;
        const parsed = z.object({ email: z.email() }).safeParse(raw);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        return user?.active ? { id: user.id, email: user.email, name: user.name } : null;
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // Expiration après 2 h d'inactivité (jeton renouvelé toutes les 15 min d'activité) ;
  // révocation immédiate par sessionVersion (déconnexion, désactivation).
  session: { strategy: "jwt", maxAge: 2 * 60 * 60, updateAge: 15 * 60 },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      if (typeof token?.uid === "string") await securityEvent("LOGOUT", { actorId: token.uid });
    },
  },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    /** Seuls les comptes provisionnés et actifs entrent : le SSO authentifie, l'app autorise. */
    async signIn({ user, account, profile }) {
      const ok =
        account?.provider === ENTRA
          ? Boolean(await resolveEntraUser(profile as EntraProfile))
          : account?.provider === "dev" && devLoginEnabled && Boolean(user.id);
      if (!ok) {
        await securityEvent("LOGIN_DENIED", {
          provider: account?.provider ?? null,
          email: maskEmail(
            typeof (profile as EntraProfile | undefined)?.email === "string"
              ? String((profile as EntraProfile).email)
              : user.email,
          ),
        });
      }
      return ok;
    },
    /** Le jeton ne porte que l'identifiant applicatif ; le rôle est relu en base à chaque requête (DAL). */
    async jwt({ token, user, account, profile }) {
      if (account) {
        const uid =
          account.provider === ENTRA
            ? (await resolveEntraUser(profile as EntraProfile))?.id
            : account.provider === "dev"
              ? user?.id
              : null;
        if (uid) {
          const { sessionVersion } = await db.user.findUniqueOrThrow({ where: { id: uid }, select: { sessionVersion: true } });
          token.uid = uid;
          token.sv = sessionVersion;
          await securityEvent("LOGIN", { actorId: uid, provider: account.provider });
        } else {
          delete token.uid;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      // Version de session vérifiée par le DAL à chaque requête
      (session as typeof session & { sv?: number }).sv = typeof token.sv === "number" ? token.sv : -1;
      return session;
    },
  },
});
