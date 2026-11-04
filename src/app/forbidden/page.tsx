import Link from "next/link";

export const metadata = { title: "Accès refusé" };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md rounded-card border border-line bg-surface p-7 text-center shadow-card">
        <h1 className="text-[22px] font-bold">Accès refusé</h1>
        <p className="mt-2 text-[13.5px] text-ink-muted">Votre profil ne donne pas accès à cette page.</p>
        <Link href="/" className="mt-5 inline-block rounded-control bg-purple px-4 py-2.5 text-[13px] font-semibold text-white">
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
