import type { Metadata } from "next";

export const metadata: Metadata = { title: "Vérifier un CRA", robots: { index: false, follow: false } };

/** Page publique (finances, clients de la facture) : pas de session requise. */
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="contenu" className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-5 px-4 py-12">
      <div className="flex items-center gap-2.5">
        <div aria-hidden className="size-[30px] rounded-[9px] bg-gradient-brand" />
        <span className="text-sm font-bold">Freelance Hub</span>
      </div>
      {children}
    </main>
  );
}
