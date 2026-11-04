import { NextResponse, type NextRequest } from "next/server";

/**
 * Contrôle optimiste uniquement : redirige vers /login quand aucun cookie de session n'est présent.
 * La vraie vérification (signature du JWT, utilisateur actif, rôle) reste dans la DAL.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // Tout sauf : auth, login, page d'accès refusé, assets Next et fichiers statiques
  matcher: ["/((?!api/auth|api/cron|login|forbidden|verify|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
