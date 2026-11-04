"use client";

import { useRef, useState, useTransition } from "react";
import { validateAllClean } from "@/app/(app)/validation/actions";

/**
 * « Tout valider » : confirmation, puis le serveur relit la file et ne valide que les CRA
 * sans avertissement (chaque CRA est recontrôlé, avec sa version, au moment de la décision).
 */
export function BulkValidate({ count }: { count: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="min-h-11 rounded-control border border-purple px-3 text-[12.5px] font-semibold text-purple hover:bg-lavender-light"
      >
        Tout valider
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="tout-valider-titre"
        // Remise à zéro aussi à la fermeture par Échap.
        onClose={() => setResult(null)}
        className="m-auto w-[min(460px,calc(100vw-32px))] rounded-card border border-line bg-surface p-6 shadow-card backdrop:bg-ink/40"
      >
        <h2 id="tout-valider-titre" className="text-[17px] font-bold">
          Tout valider
        </h2>
        <p className="mt-2 text-[13px] text-ink-muted">
          {count} CRA dans la file. Seront validés ceux qui n&apos;ont <strong>aucun avertissement</strong> : travail un week-end ou
          un férié, heures sup. au-delà du seuil, bon de commande tendu ou dépassé, mois non terminé. Les simples informations
          (astreintes, commentaires, jours non saisis, variation de montant) n&apos;empêchent pas la validation.
        </p>
        <p role="status" className="mt-3 min-h-5 text-[13px] font-semibold text-success">
          {result}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="min-h-11 rounded-control border border-line-strong px-4 text-[12.5px] font-semibold text-ink-3"
          >
            {result ? "Fermer" : "Annuler"}
          </button>
          {!result ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await validateAllClean();
                  setResult(
                    `${r.validated} CRA validé${r.validated > 1 ? "s" : ""}, ${r.skipped} à examiner un par un${
                      r.remaining > 0 ? `, ${r.remaining} restant${r.remaining > 1 ? "s" : ""} (relancez l'action)` : ""
                    }.`,
                  );
                })
              }
              className="min-h-11 rounded-control bg-gradient-primary px-4 text-[12.5px] font-semibold text-white shadow-cta disabled:opacity-50"
            >
              {pending ? "Validation…" : "Valider les CRA sans avertissement"}
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
