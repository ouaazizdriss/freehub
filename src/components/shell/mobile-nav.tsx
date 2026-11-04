"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

/**
 * Navigation mobile (< md) : barre supérieure + tiroir (dialog modal natif : focus piégé,
 * Échap pour fermer). Le contenu du tiroir est la navigation serveur passée en enfant.
 */
export function MobileNav({ brand, children }: { brand: React.ReactNode; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <div data-noprint className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:hidden">
      {brand}
      {/* Lecture de l'URL sous Suspense : le cadre de la page reste prérendu (Cache Components). */}
      <Suspense fallback={null}>
        <CloseOnNavigate dialog={dialog} />
      </Suspense>
      <button
        type="button"
        aria-label="Ouvrir le menu"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="grid size-11 place-items-center rounded-control border border-line-strong"
      >
        <Menu aria-hidden className="size-5" />
      </button>
      <dialog
        ref={dialog}
        aria-label="Menu"
        // Fermeture au clic sur le fond (la cible est alors le dialog lui-même) ou sur un lien,
        // y compris vers la page courante (pas de changement d'URL pour déclencher la fermeture).
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest("a")) e.currentTarget.close();
        }}
        className="m-0 ml-auto h-dvh max-h-dvh w-[min(300px,85vw)] bg-surface p-0 backdrop:bg-ink/40"
      >
        <div className="flex h-full flex-col gap-5 px-3.5 py-4">
          <div className="flex items-center justify-between">
            {brand}
            <button
              type="button"
              aria-label="Fermer le menu"
              onClick={() => dialog.current?.close()}
              className="grid size-11 place-items-center rounded-control border border-line-strong"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </div>
  );
}

/** Ferme le tiroir après une navigation. */
function CloseOnNavigate({ dialog }: { dialog: React.RefObject<HTMLDialogElement | null> }) {
  const pathname = usePathname();
  useEffect(() => {
    dialog.current?.close();
  }, [pathname, dialog]);
  return null;
}
