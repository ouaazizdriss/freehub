"use client";

import { PenLine, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { uploadSignature } from "@/app/(app)/cra/signature-actions";

const MAX_BYTES = 1024 * 1024;

/** Signature du freelance : aperçu, statut, dépôt / remplacement (PNG ou JPG, 1 Mo max.). */
export function SignatureCard({ signature }: { signature: { version: number } | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return setMessage("Image trop lourde (1 Mo maximum).");
    if (!["image/png", "image/jpeg"].includes(file.type)) return setMessage("Format accepté : PNG ou JPG.");
    const data = new FormData();
    data.set("signature", file);
    startTransition(async () => {
      const result = await uploadSignature(data);
      setMessage(result.ok ? "Signature enregistrée." : result.message);
      if (input.current) input.current.value = "";
      if (result.ok) router.refresh();
    });
  };

  return (
    <section aria-labelledby={`${id}-titre`} className="rounded-card border border-line bg-surface px-5 py-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-titre`} className="flex items-center gap-1.5 text-[13px] font-bold">
          <PenLine aria-hidden className="size-4 text-purple" />
          Signature
        </h2>
        <span
          className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${signature ? "bg-success-bg text-success" : "bg-warning-bg text-warning"}`}
        >
          {signature ? "Apposée" : "À déposer"}
        </span>
      </div>
      <div className="mt-3 grid h-[88px] place-items-center rounded-control border border-dashed border-line-strong bg-surface-soft">
        {signature ? (
          // eslint-disable-next-line @next/next/no-img-element -- image privée servie par une route authentifiée
          <img src={`/api/signature?v=${signature.version}`} alt="Votre signature" className="max-h-[76px] max-w-[90%] object-contain" />
        ) : (
          <p className="px-3 text-center text-[11.5px] text-ink-subtle">Obligatoire pour soumettre : elle figure sur le PDF du CRA.</p>
        )}
      </div>
      <input
        ref={input}
        id={`${id}-fichier`}
        type="file"
        accept="image/png,image/jpeg"
        disabled={pending}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <label
        htmlFor={`${id}-fichier`}
        aria-disabled={pending || undefined}
        className="mt-2.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-line-strong text-[12.5px] font-semibold text-ink-3 hover:bg-surface-soft aria-disabled:pointer-events-none aria-disabled:opacity-50 [input:focus-visible+&]:outline-2 [input:focus-visible+&]:outline-pink-ink"
      >
        <Upload aria-hidden className="size-4" />
        {pending ? "Envoi…" : signature ? "Remplacer la signature" : "Déposer une signature"}
      </label>
      <p className="mt-1 text-[11px] text-ink-subtle">PNG ou JPG, 1 Mo max. Les marges blanches sont rognées.</p>
      <p role="status" className="mt-1 min-h-4 text-[11.5px] font-semibold text-ink-3">
        {message}
      </p>
    </section>
  );
}
