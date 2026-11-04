"use client";

import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { requestCorrection, validateTimesheet, type DecisionResult } from "@/app/(app)/validation/actions";
import { DayGrid, type HolidayInfo } from "@/components/cra/day-grid";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/status-pill";
import { MAX_REJECTION_REASON, MIN_REJECTION_REASON, type AttentionLevel } from "@/lib/domain/attention";
import { formatLongDate, formatMonth, isoDate, type IsoDate } from "@/lib/domain/calendar";
import { DAY_KIND_LABELS, emptyDay, kindOf } from "@/lib/domain/cra-editor";
import { formatDays, formatEur } from "@/lib/domain/timesheet";
import type { ValidationDetail } from "@/lib/queries/validation";

const LEVEL_STYLE: Record<AttentionLevel, { box: string; Icon: typeof Info }> = {
  ok: { box: "bg-success-bg text-success", Icon: CircleCheck },
  warning: { box: "bg-warning-bg text-warning", Icon: CircleAlert },
  info: { box: "bg-lavender-light text-cell-half-ink", Icon: Info },
};

export const AUDIT_LABELS: Record<string, string> = {
  CREATE: "Brouillon créé",
  SUBMIT: "Soumis",
  VALIDATE: "Validé",
  REJECT: "Correction demandée",
  PDF_DOWNLOAD: "PDF téléchargé",
  XLSX_DOWNLOAD: "Export Excel téléchargé",
};

const ERRORS: Record<Exclude<DecisionResult, { ok: true }>["error"], string> = {
  NOT_FOUND: "CRA introuvable ou hors de votre périmètre.",
  CONFLICT: "Ce CRA a déjà été traité ou modifié entre-temps. La page va se mettre à jour.",
  INVALID: "Données invalides.",
};

export function DecisionPanel({
  detail,
  canDecide,
  nextHref,
}: {
  detail: ValidationDetail;
  canDecide: boolean;
  nextHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<IsoDate>(detail.days[0]?.date ?? isoDate(detail.year, detail.month1, 1));
  const dialog = useRef<HTMLDialogElement>(null);

  const days = new Map(detail.days.map((d) => [d.date, d]));
  const holidays = new Map<IsoDate, HolidayInfo>(
    detail.holidays.map((h) => [h.date, { label: h.label, tentative: h.tentative }]),
  );
  const day = days.get(selected) ?? emptyDay(selected);
  const decidable = canDecide && detail.status === "SUBMITTED";
  const eur = (c: number | null) => formatEur(c ?? 0);

  const run = (action: () => Promise<DecisionResult>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (result.ok) {
        onDone?.();
        router.push(nextHref);
      } else {
        setError(result.message ?? ERRORS[result.error]);
        if (result.error === "CONFLICT") router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface px-5 py-[18px] shadow-card">
      <div className="flex items-center gap-3">
        <Avatar name={detail.freelancerName} size={40} gradient />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15.5px] font-bold">{detail.freelancerName}</h2>
          <p className="truncate text-[12px] text-ink-subtle">
            {detail.missionName} · {detail.poNumber}
          </p>
        </div>
        <StatusPill status={detail.status} />
      </div>
      <div className="-mt-2 flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold capitalize">{formatMonth(detail.year, detail.month1)}</p>
        <div className="flex gap-1.5">
          <a
            href={`/api/cra/${encodeURIComponent(detail.id)}/pdf`}
            target="_blank"
            rel="noopener"
            className="flex min-h-9 items-center rounded-control border border-line-strong px-2.5 text-[12px] font-semibold text-ink-3 hover:bg-surface-soft"
          >
            PDF<span className="sr-only"> du CRA (nouvel onglet)</span>
          </a>
          <a
            href={`/api/cra/${encodeURIComponent(detail.id)}/xlsx`}
            className="flex min-h-9 items-center rounded-control border border-line-strong px-2.5 text-[12px] font-semibold text-ink-3 hover:bg-surface-soft"
          >
            Excel<span className="sr-only"> du CRA</span>
          </a>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        {[
          ["Jours", `${formatDays(detail.totalWorkHalfDays)} j`],
          ["H. sup.", `${detail.totalOvertimeHours} h`],
          ["TJM", eur(detail.dailyRateCents)],
          ["Montant HT", eur(detail.totalAmountCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-cell bg-surface-soft px-3 py-2">
            <dt className="text-[10.5px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">{label}</dt>
            <dd className="text-[15px] font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {detail.status === "REJECTED" && detail.rejectionReason ? (
        <p className="rounded-control bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <strong>Correction demandée :</strong> {detail.rejectionReason}
        </p>
      ) : null}

      <section aria-labelledby="attention-titre" className="flex flex-col gap-2">
        <h3 id="attention-titre" className="text-[12.5px] font-bold">
          Points d&apos;attention
        </h3>
        <ul className="flex flex-col gap-1.5">
          {detail.points.map((p) => {
            const { box, Icon } = LEVEL_STYLE[p.level];
            return (
              <li key={p.code} className={`flex gap-2 rounded-control px-3 py-2 text-[12px] ${box}`}>
                <Icon aria-hidden className="mt-0.5 size-3.5 flex-none" />
                <span>
                  {p.text}
                  {p.dates && p.dates.length > 0 ? (
                    <span className="ml-1 inline-flex flex-wrap gap-1">
                      {p.dates.slice(0, 6).map((d) => (
                        <button
                          key={d}
                          type="button"
                          aria-label={`Voir le ${formatLongDate(d)}`}
                          onClick={() => setSelected(d)}
                          className="-my-1 min-w-6 px-1 py-1 font-semibold underline"
                        >
                          {Number(d.slice(8))}
                        </button>
                      ))}
                      {p.dates.length > 6 ? <span>…</span> : null}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Détail des jours" className="flex flex-col gap-2">
        <DayGrid
          compact
          year={detail.year}
          month1={detail.month1}
          days={days}
          holidays={holidays}
          periods={detail.periods}
          selected={selected}
          issueDates={new Set()}
          onSelect={setSelected}
          onShortcut={() => {}}
        />
        <div className="rounded-control bg-surface-soft px-3 py-2 text-[12px]" aria-live="polite">
          <p className="font-semibold">
            {formatLongDate(selected)} — {DAY_KIND_LABELS[kindOf(day)]}
            {day.overtimeHours > 0 ? ` · ${day.overtimeHours} h sup.` : ""}
            {day.onCall ? " · astreinte" : ""}
          </p>
          {day.exceptionReason ? <p className="text-ink-3">Motif : {day.exceptionReason}</p> : null}
          {day.comment ? <p className="text-ink-3">Commentaire : {day.comment}</p> : null}
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {decidable ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => validateTimesheet({ id: detail.id, version: detail.version }))}
            className="min-h-11 rounded-control bg-gradient-primary text-[13px] font-semibold text-white shadow-cta disabled:opacity-50"
          >
            {pending ? "Traitement…" : "Valider le CRA"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => dialog.current?.showModal()}
            className="min-h-11 rounded-control border border-line-strong text-[13px] font-semibold text-ink-3 hover:border-danger hover:text-danger disabled:opacity-50"
          >
            Demander une correction
          </button>
          <RejectDialog
            ref={dialog}
            pending={pending}
            error={error}
            onConfirm={(reason) =>
              run(
                () => requestCorrection({ id: detail.id, version: detail.version, reason }),
                () => dialog.current?.close(),
              )
            }
          />
        </div>
      ) : !canDecide ? (
        <p className="rounded-control bg-surface-sunken px-3 py-2 text-[12px] text-ink-subtle">
          Consultation seule pour votre profil.
        </p>
      ) : null}

      {detail.history.length > 0 ? (
        <section aria-labelledby="historique-cra" className="border-t border-line-soft pt-3">
          <h3 id="historique-cra" className="mb-1.5 text-[12.5px] font-bold">
            Historique
          </h3>
          <ol className="flex flex-col gap-1 text-[11.5px] text-ink-3">
            {detail.history.map((h) => (
              <li key={h.id}>
                <span className="font-semibold">{AUDIT_LABELS[h.action] ?? h.action}</span>
                {h.actorName ? ` par ${h.actorName}` : ""} — {h.at}
                {h.reason ? <span className="block text-ink-subtle">« {h.reason} »</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function RejectDialog({
  ref,
  pending,
  error,
  onConfirm,
}: {
  ref: React.Ref<HTMLDialogElement>;
  pending: boolean;
  /** Erreur affichée dans le dialogue : le reste de la page est inerte tant qu'il est ouvert */
  error: string | null;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const id = useId();
  const valid = reason.trim().length >= MIN_REJECTION_REASON;
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-titre`}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-card border border-line bg-surface p-6 shadow-card backdrop:bg-ink/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(reason.trim());
        }}
      >
        <h2 id={`${id}-titre`} className="text-[17px] font-bold">
          Demander une correction
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">Le freelance est prévenu par e-mail et peut corriger puis resoumettre.</p>
        <label htmlFor={`${id}-motif`} className="mt-4 block text-[11.5px] font-semibold text-ink-muted">
          Motif (obligatoire, {MIN_REJECTION_REASON} caractères minimum)
        </label>
        <textarea
          id={`${id}-motif`}
          required
          minLength={MIN_REJECTION_REASON}
          maxLength={MAX_REJECTION_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 min-h-24 w-full rounded-control border border-line-strong px-3 py-2 text-[13px]"
        />
        <p className="text-right text-[11px] text-ink-subtle tabular-nums">
          {reason.length} / {MAX_REJECTION_REASON}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={(e) => (e.currentTarget.closest("dialog") as HTMLDialogElement).close()}
            className="min-h-11 rounded-control border border-line-strong px-4 text-[12.5px] font-semibold text-ink-3"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={!valid || pending}
            className="min-h-11 rounded-control bg-danger px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Envoi…" : "Envoyer la demande"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
