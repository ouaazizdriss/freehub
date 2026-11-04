"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useId, useRef, useState } from "react";
import type { FormState } from "@/app/(app)/freelances/actions";

const ErrorsContext = createContext<Record<string, string> | undefined>(undefined);

/**
 * Formulaire relié à une Server Action (useActionState) : message de résultat annoncé,
 * erreurs par champ, bouton désactivé pendant l'envoi. Fonctionne aussi sans JavaScript.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  resetOnSuccess = false,
  onSuccess,
  className = "",
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  children: React.ReactNode;
  resetOnSuccess?: boolean;
  onSuccess?: (state: NonNullable<FormState>) => void;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [clientError, setClientError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) form.current?.reset();
      onSuccessRef.current?.(state);
    } else if (state) {
      // Erreur : focus sur le premier champ signalé (sinon le message reste lu par la zone d'alerte).
      form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
    }
  }, [state, resetOnSuccess]);
  const error = clientError ?? (state && !state.ok ? state.message : null);
  const success = !clientError && state?.ok ? state.message : null;

  return (
    <form
      ref={form}
      action={formAction}
      // Envoi manuel : React réinitialise sinon le formulaire après chaque action, y compris en
      // cas d'erreur (la saisie serait perdue). `action` reste pour le fonctionnement sans JS.
      onSubmit={(e) => {
        e.preventDefault();
        // Fichiers trop lourds refusés avant l'envoi (au-delà de la limite serveur, Next rejette la
        // requête sans que l'action puisse répondre proprement).
        for (const input of e.currentTarget.querySelectorAll<HTMLInputElement>("input[type=file][data-max-bytes]")) {
          const file = input.files?.[0];
          if (file && file.size > Number(input.dataset.maxBytes)) {
            setClientError(`Fichier trop lourd (${Math.round(Number(input.dataset.maxBytes) / 1024 / 1024)} Mo maximum).`);
            input.focus();
            return;
          }
        }
        setClientError(null);
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={`flex flex-col gap-3 ${className}`}
    >
      <ErrorsContext value={state?.ok ? undefined : state?.errors}>{children}</ErrorsContext>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-control bg-gradient-primary px-4 text-[12.5px] font-semibold text-white shadow-cta disabled:opacity-50"
        >
          {pending ? "Enregistrement…" : submitLabel}
        </button>
        {/* Zones toujours présentes : un changement de contenu est annoncé de façon fiable. */}
        <p role="status" className="text-[12.5px] font-semibold text-success">
          {success}
        </p>
        <p role="alert" className="text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      </div>
    </form>
  );
}

type FieldProps = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  hint?: string;
  children?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "defaultValue" | "children">;

/** Champ libellé ; `children` = options d'un <select>. */
export function Field({ name, label, type = "text", required, defaultValue, hint, children, ...rest }: FieldProps) {
  const errors = useContext(ErrorsContext);
  const id = useId();
  const error = errors?.[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    name,
    required,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: "min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-[13px] aria-invalid:border-danger",
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11.5px] font-semibold text-ink-muted">
        {label}
        {required ? <span aria-hidden> *</span> : null}
      </label>
      {children ? (
        <select {...common} defaultValue={defaultValue ?? ""}>
          {children}
        </select>
      ) : (
        <input {...common} type={type} defaultValue={defaultValue ?? undefined} {...rest} />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} className="text-[11.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
