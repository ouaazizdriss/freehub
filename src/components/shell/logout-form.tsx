"use client";

import { LogOut } from "lucide-react";

/** Clés des copies locales de saisie (mode hors ligne) — effacées à la déconnexion. */
export const LOCAL_DRAFT_PREFIX = "fh:cra:";

function clearLocalDrafts() {
  try {
    for (const key of Object.keys(window.localStorage))
      if (key.startsWith(LOCAL_DRAFT_PREFIX)) window.localStorage.removeItem(key);
  } catch {
    /* stockage indisponible */
  }
}

/** Déconnexion : efface d'abord les saisies hors ligne de l'appareil (poste partagé), puis Server Action. */
export function LogoutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={clearLocalDrafts}>
      <button
        type="submit"
        title="Se déconnecter"
        className="flex size-11 items-center justify-center rounded-chip text-ink-subtle hover:bg-surface-sunken hover:text-ink md:size-8"
      >
        <LogOut aria-hidden size={16} />
        <span className="sr-only">Se déconnecter</span>
      </button>
    </form>
  );
}
