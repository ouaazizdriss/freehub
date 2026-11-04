"use client";

import { CalendarRange, Minus, Plus, Zap } from "lucide-react";
import { useId } from "react";
import { formatLongDate } from "@/lib/domain/calendar";
import {
  DAY_KIND_LABELS,
  issueMessage,
  kindOf,
  MAX_COMMENT_LENGTH,
  withKind,
  type DayKind,
  type EditableDay,
  type SubmissionIssue,
} from "@/lib/domain/cra-editor";
import { MAX_OVERTIME_HOURS_PER_DAY } from "@/lib/domain/timesheet";
import type { HolidayInfo } from "./day-grid";

type Props = {
  day: EditableDay;
  holiday?: HolidayInfo;
  weekend: boolean;
  inContract: boolean;
  editable: boolean;
  issues: SubmissionIssue[];
  missionName: string;
  poNumber: string;
  rateLabel: string;
  weekFeedback: string | null;
  onChange: (next: EditableDay) => void;
  onApplyWeek: () => void;
};

const label = "text-[11.5px] font-semibold text-ink-muted";
const segment = (active: boolean) =>
  `min-h-11 rounded-control border px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    active ? "border-purple bg-purple text-white" : "border-line-strong bg-surface text-ink-3 enabled:hover:bg-surface-soft"
  }`;

export function DayPanel(props: Props) {
  const { day, holiday, weekend, inContract, editable, issues } = props;
  const kind = kindOf(day);
  const canEdit = editable && inContract;
  const ids = { comment: useId(), reason: useId(), overtime: useId(), onCall: useId() };
  const set = (patch: Partial<EditableDay>) => props.onChange({ ...day, ...patch });
  const needsReason = (weekend || !!holiday) && day.workHalfDays > 0;

  return (
    <section aria-labelledby="journee-titre" className="flex flex-col gap-4">
      <div>
        <p className={label}>Journée sélectionnée</p>
        <h2 id="journee-titre" className="text-[17px] font-bold first-letter:uppercase">
          {new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day.date}T00:00:00Z`))}{" "}
          {formatLongDate(day.date)}
        </h2>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {holiday ? (
            <span className="rounded-pill bg-cell-holiday px-2 py-0.5 text-[11px] font-semibold text-cell-holiday-ink">
              Férié · {holiday.label}
              {holiday.tentative ? " (date estimée)" : ""}
            </span>
          ) : null}
          {weekend ? (
            <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">Week-end</span>
          ) : null}
          {!inContract ? (
            <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-ink-subtle">
              Hors période du contrat
            </span>
          ) : null}
        </div>
      </div>

      <fieldset disabled={!canEdit} className="flex flex-col gap-2">
        <legend className={`${label} mb-2`}>Type de journée</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(DAY_KIND_LABELS) as DayKind[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => props.onChange(withKind(day, k))}
              className={segment(kind === k)}
            >
              {DAY_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {kind === "half" ? (
          <div className="mt-1 flex flex-col gap-2 rounded-control bg-surface-soft p-2.5">
            <div role="group" aria-label="Demi-journée travaillée" className="grid grid-cols-2 gap-1.5">
              {(["AM", "PM"] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={day.half === h}
                  onClick={() => set({ half: h })}
                  className={segment(day.half === h)}
                >
                  {h === "AM" ? "Matin" : "Après-midi"}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Autre demi-journée" className="grid grid-cols-2 gap-1.5">
              {[
                [0, "Non travaillée"],
                [1, "Absence"],
              ].map(([v, text]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={day.absenceHalfDays === v}
                  onClick={() => set({ absenceHalfDays: v as number })}
                  className={segment(day.absenceHalfDays === v)}
                >
                  {text}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-subtle">L&apos;autre moitié de la journée.</p>
          </div>
        ) : null}

        {needsReason ? (
          <div className="mt-1 flex flex-col gap-1">
            <label htmlFor={ids.reason} className={label}>
              Motif de dérogation <span className="text-danger">(obligatoire)</span>
            </label>
            <input
              id={ids.reason}
              value={day.exceptionReason ?? ""}
              maxLength={MAX_COMMENT_LENGTH}
              onChange={(e) => set({ exceptionReason: e.target.value })}
              placeholder="Ex. mise en production"
              aria-invalid={!day.exceptionReason?.trim()}
              className="min-h-11 rounded-control border border-line-strong px-3 text-[13px] aria-invalid:border-danger"
            />
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1">
        <span className={label}>Mission imputée</span>
        <div className="flex flex-col gap-0.5 rounded-control border border-line-strong bg-surface-soft px-3 py-2.5">
          <span className="text-[12.5px] font-semibold">{props.missionName}</span>
          <span className="text-[11px] text-ink-subtle">
            {props.poNumber} · {props.rateLabel}
          </span>
        </div>
      </div>

      <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className={label} id={ids.overtime}>
            Heures sup.
          </span>
          <div role="group" aria-labelledby={ids.overtime} className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Retirer une heure"
              disabled={day.workHalfDays === 0 || day.overtimeHours <= 0}
              onClick={() => set({ overtimeHours: day.overtimeHours - 1 })}
              className="grid size-11 place-items-center rounded-control border border-line-strong disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <output key={day.date} aria-live="polite" className="w-12 text-center text-[15px] font-bold tabular-nums">
              {day.workHalfDays === 0 ? 0 : day.overtimeHours} h
            </output>
            <button
              type="button"
              aria-label="Ajouter une heure"
              disabled={day.workHalfDays === 0 || day.overtimeHours >= MAX_OVERTIME_HOURS_PER_DAY}
              onClick={() => set({ overtimeHours: day.overtimeHours + 1 })}
              className="grid size-11 place-items-center rounded-control border border-line-strong disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className={label} id={ids.onCall}>
            Astreinte
          </span>
          <button
            type="button"
            // Nom = libellé + état visible (« Astreinte Non ») : le nom contient le texte affiché (WCAG 2.5.3).
            // Pas d'aria-pressed : l'état est déjà dans le nom (sinon annoncé deux fois).
            aria-labelledby={`${ids.onCall} ${ids.onCall}-etat`}
            disabled={day.absenceHalfDays === 2}
            onClick={() => set({ onCall: !day.onCall })}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-control border text-[12.5px] font-semibold disabled:opacity-40 ${
              day.onCall ? "border-orange-ink bg-orange-ink text-white" : "border-line-strong bg-surface text-ink-3"
            }`}
          >
            <Zap aria-hidden className="size-3.5" />
            <span id={`${ids.onCall}-etat`}>{day.onCall ? "Oui" : "Non"}</span>
          </button>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.comment} className={label}>
          Commentaire
        </label>
        <textarea
          id={ids.comment}
          value={day.comment ?? ""}
          disabled={!canEdit}
          maxLength={MAX_COMMENT_LENGTH}
          onChange={(e) => set({ comment: e.target.value })}
          className="min-h-14 resize-y rounded-control border border-line-strong px-3 py-2 text-[13px] disabled:bg-surface-soft"
        />
      </div>

      {issues.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-control bg-danger-bg px-3 py-2 text-[12px] text-danger">
          {issues.map((i) => (
            <li key={i.code}>{issueMessage(i)}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={!canEdit}
          onClick={props.onApplyWeek}
          className="flex min-h-11 items-center justify-center gap-2 rounded-control border border-purple text-[12.5px] font-semibold text-purple enabled:hover:bg-lavender-light disabled:opacity-40"
        >
          <CalendarRange className="size-4" />
          Appliquer à toute la semaine
        </button>
        <p aria-live="polite" className="min-h-4 text-center text-[11px] text-ink-subtle">
          {props.weekFeedback}
        </p>
      </div>
    </section>
  );
}
