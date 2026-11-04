import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Connexion de démo (sélection d'un compte seedé, sans mot de passe).
 * Jamais disponible en production, même si AUTH_DEV_LOGIN=true.
 */
export const devLoginEnabled = process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "true";
export const ssoEnabled = Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);

const providers = [];
if (ssoEnabled) providers.push(MicrosoftEntraID);
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Compte de démo",
      credentials: { email: { label: "E-mail", type: "email" } },
      async authorize(raw) {
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
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    /** Seuls les comptes provisionnés et actifs entrent : le SSO authentifie, l'app autorise. */
    async signIn({ user }) {
      if (!user.email) return false;
      const known = await db.user.findUnique({ where: { email: user.email.toLowerCase() }, select: { active: true } });
      return Boolean(known?.active);
    },
    /** Le jeton ne porte que l'identifiant ; le rôle est relu en base à chaque requête (DAL). */
    async jwt({ token, user }) {
      if (user?.email) {
        const known = await db.user.findUnique({ where: { email: user.email.toLowerCase() }, select: { id: true } });
        if (known) token.uid = known.id;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});
