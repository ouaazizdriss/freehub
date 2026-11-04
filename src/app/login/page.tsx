import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { devLoginEnabled, signIn, ssoEnabled } from "@/auth";
import { BrandMark } from "@/components/shell/brand-mark";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { homeFor, ROLE_LABELS } from "@/lib/navigation";

export const metadata: Metadata = { title: "Connexion" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Votre compte n'est pas autorisé sur Freelance Hub. Contactez l'équipe Achats.",
  CredentialsSignin: "Compte de démo introuvable ou désactivé.",
};

/** Lit la session puis redirige : rendu bloquant assumé. */
export const instant = false;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));

  const { error } = await searchParams;
  const demoUsers = devLoginEnabled
    ? await db.user.findMany({
        where: { active: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
        select: { email: true, name: true, role: true },
      })
    : [];

  async function loginSso() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: "/" });
  }
  async function loginDemo(formData: FormData) {
    "use server";
    await signIn("dev", { email: formData.get("email"), redirectTo: "/" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-7 shadow-card">
        <BrandMark />
        <h1 className="mt-6 text-[22px] font-bold tracking-[-0.02em]">Connexion</h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">Gestion des freelances et du CRA mensuel.</p>

        {error ? (
          <p role="alert" className="mt-4 rounded-control bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            {ERRORS[error] ?? "La connexion a échoué. Réessayez."}
          </p>
        ) : null}

        {ssoEnabled ? (
          <form action={loginSso} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-control bg-gradient-primary px-4 py-3 text-[13.5px] font-semibold text-white shadow-cta"
            >
              Se connecter avec Microsoft
            </button>
          </form>
        ) : (
          <p className="mt-6 rounded-control bg-warning-bg px-3 py-2.5 text-[13px] text-warning">
            SSO Entra ID non configuré (variables <code>AUTH_MICROSOFT_ENTRA_ID_*</code>).
          </p>
        )}

        {devLoginEnabled && demoUsers.length > 0 ? (
          <section aria-labelledby="demo-title" className="mt-7 border-t border-line pt-5">
            <h2 id="demo-title" className="text-[11px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">
              Comptes de démo · développement uniquement
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {demoUsers.map((u) => (
                <li key={u.email}>
                  <form action={loginDemo}>
                    <input type="hidden" name="email" value={u.email} />
                    <button
                      type="submit"
                      className="flex w-full items-center justify-between rounded-control border border-line-strong px-3.5 py-2.5 text-left text-[13px] hover:bg-lavender-light"
                    >
                      <span className="font-semibold">{u.name}</span>
                      <span className="text-xs text-ink-subtle">{ROLE_LABELS[u.role]}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
