"use client";

import { MessageSquare, TriangleAlert, Zap } from "lucide-react";
import { useRef } from "react";
import { formatLongDate, isWeekend, monthGrid, weekdayMon0, type IsoDate } from "@/lib/domain/calendar";
import { emptyDay, inPeriod, kindOf, type DayKind, type EditableDay, type Period } from "@/lib/domain/cra-editor";
import { formatDays } from "@/lib/domain/timesheet";

export type HolidayInfo = { label: string; tentative: boolean };

const WEEKDAYS = [
  ["Lun", "lundi"],
  ["Mar", "mardi"],
  ["Mer", "mercredi"],
  ["Jeu", "jeudi"],
  ["Ven", "vendredi"],
  ["Sam", "samedi"],
  ["Dim", "dimanche"],
] as const;

/** Raccourcis clavier de saisie (documentés sous la grille). */
export const KIND_SHORTCUTS: Record<string, DayKind> = { j: "work", d: "half", a: "absence", n: "off", Delete: "off" };

type CellLook = { className: string; label: string; spoken: string };

export function describeDay(day: EditableDay, opts: { holiday?: HolidayInfo; weekend: boolean; inContract: boolean }): CellLook {
  const kind = kindOf(day);
  if (!opts.inContract)
    return { className: "bg-cell-weekend border-cell-weekend-line text-cell-weekend-ink", label: "", spoken: "hors contrat" };
  if (kind === "work")
    return { className: "bg-cell-work border-cell-work-line text-cell-work-ink", label: "1 j", spoken: "1 journée" };
  if (kind === "half") {
    const mixed = day.absenceHalfDays > 0;
    return {
      className: "bg-cell-half border-cell-half-line text-cell-half-ink",
      label: mixed ? "0,5 j + abs." : "0,5 j",
      spoken: `demi-journée ${day.half === "PM" ? "l'après-midi" : "le matin"}${mixed ? ", demi-journée d'absence" : ""}`,
    };
  }
  if (kind === "absence")
    return { className: "bg-cell-absence border-cell-absence-line text-cell-absence-ink", label: "Absence", spoken: "absence" };
  if (opts.holiday)
    return {
      className: "bg-cell-holiday border-cell-holiday-line text-cell-holiday-ink",
      label: "Férié",
      spoken: `férié, ${opts.holiday.label}`,
    };
  if (opts.weekend)
    return { className: "bg-cell-weekend border-cell-weekend-line text-cell-weekend-ink", label: "", spoken: "week-end" };
  return { className: "bg-cell-empty border-cell-empty-line text-cell-empty-ink", label: "—", spoken: "non travaillé" };
}

type Props = {
  year: number;
  month1: number;
  days: ReadonlyMap<IsoDate, EditableDay>;
  holidays: ReadonlyMap<IsoDate, HolidayInfo>;
  periods: readonly Period[];
  selected: IsoDate;
  issueDates: ReadonlySet<IsoDate>;
  onSelect: (date: IsoDate) => void;
  onShortcut: (kind: DayKind) => void;
  /** Version réduite (panneau de validation) */
  compact?: boolean;
  /** Jours couverts par une absence déclarée (signalés tant qu'ils sont vides) */
  declared?: ReadonlySet<IsoDate>;
};

/**
 * Grille mensuelle (motif ARIA « grid ») : une seule cellule dans l'ordre de tabulation,
 * flèches pour se déplacer (la sélection suit le focus), Début/Fin pour la semaine,
 * lettres J / D / A / N pour saisir le type de la journée sélectionnée.
 */
export function DayGrid({
  year,
  month1,
  days,
  holidays,
  periods,
  selected,
  issueDates,
  onSelect,
  onShortcut,
  compact = false,
  declared,
}: Props) {
  // Mobile : cases de 44 px (cible tactile), sans libellé ; le type reste porté par la couleur et le nom accessible.
  const cellHeight = compact ? "h-[40px]" : "h-11 sm:h-[74px]";
  const { leadingBlanks, rows, dates } = monthGrid(year, month1);
  const cells = useRef(new Map<IsoDate, HTMLDivElement>());

  const move = (date: IsoDate) => {
    onSelect(date);
    cells.current.get(date)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const index = dates.indexOf(selected);
    const weekday = weekdayMon0(selected);
    const target: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index - 7,
      ArrowDown: index + 7,
      Home: index - weekday,
      End: index + (6 - weekday),
    };
    if (e.key in target) {
      e.preventDefault();
      // Motif ARIA grid : pas de déplacement au-delà des bords (ni de rebouclage).
      const next = Math.min(Math.max(target[e.key], 0), dates.length - 1);
      if (target[e.key] === next) move(dates[next]);
      return;
    }
    const kind = KIND_SHORTCUTS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (kind) {
      e.preventDefault();
      onShortcut(kind);
    }
  };

  const grid: (IsoDate | null)[] = [...Array<null>(leadingBlanks).fill(null), ...dates];
  while (grid.length < rows * 7) grid.push(null);

  return (
    <div
      role="grid"
      aria-label="Jours du mois"
      onKeyDown={onKeyDown}
      className={`flex flex-col ${compact ? "gap-1" : "gap-1 sm:gap-1.5"}`}
    >
      <div role="row" className={`grid grid-cols-7 ${compact ? "gap-1" : "gap-1 sm:gap-1.5"}`}>
        {WEEKDAYS.map(([short, long]) => (
          <div
            key={short}
            role="columnheader"
            aria-label={long}
            className="px-1 text-[10.5px] font-semibold tracking-[0.06em] text-ink-subtle uppercase"
          >
            {short}
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} role="row" className={`grid grid-cols-7 ${compact ? "gap-1" : "gap-1 sm:gap-1.5"}`}>
          {grid.slice(r * 7, r * 7 + 7).map((date, c) => {
            if (!date) return <div key={`blank-${c}`} role="gridcell" aria-hidden className={cellHeight} />;
            const day = days.get(date) ?? emptyDay(date);
            const holiday = holidays.get(date);
            const inContract = inPeriod(date, periods);
            const pendingAbsence = !!declared?.has(date) && kindOf(day) === "off" && inContract;
            const look = pendingAbsence
              ? {
                  className: "bg-cell-empty border-dashed border-cell-absence-ink text-cell-absence-ink",
                  label: "Abs. ?",
                  spoken: "absence déclarée, non reportée",
                }
              : describeDay(day, { holiday, weekend: isWeekend(date), inContract });
            const isSelected = date === selected;
            const hasIssue = issueDates.has(date);
            const extras = [
              day.overtimeHours > 0 && day.workHalfDays > 0 ? `${day.overtimeHours} h sup.` : null,
              day.onCall ? "astreinte" : null,
              day.comment ? "commentaire" : null,
              holiday && kindOf(day) !== "off" ? `férié (${holiday.label})` : null,
              hasIssue ? "à corriger" : null,
            ].filter(Boolean);
            return (
              <div
                key={date}
                ref={(el) => {
                  if (el) cells.current.set(date, el);
                  else cells.current.delete(date);
                }}
                role="gridcell"
                data-date={date}
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                onClick={() => move(date)}
                className={`relative flex ${cellHeight} cursor-pointer flex-col rounded-cell border transition-[background,box-shadow] duration-150 select-none ${look.className} ${
                  compact ? "px-1.5 py-1" : "px-1.5 py-1 sm:px-[9px] sm:py-2"
                } ${isSelected ? `border-2 border-pink shadow-selected ${compact ? "px-[5px] py-[3px]" : "px-[5px] py-[3px] sm:px-2 sm:py-[7px]"}` : hasIssue ? "border-danger" : ""}`}
              >
                {/* Nom accessible porté par le contenu (pas d'aria-label) : WCAG 2.5.3, le nom contient le texte visible. */}
                <span className="sr-only">
                  {[formatLongDate(date), look.label && look.label !== "—" ? look.label : null, look.spoken, ...extras]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                <span aria-hidden className={compact ? "text-[10px] font-semibold" : "text-[11.5px] font-semibold"}>
                  {Number(date.slice(8))}
                </span>
                {compact ? null : (
                  <span aria-hidden className="hidden text-[12.5px] font-bold sm:inline">
                    {look.label}
                  </span>
                )}
                {/* Mobile : marque visible pour une absence déclarée à reporter */}
                {pendingAbsence && !compact ? (
                  <span aria-hidden className="text-[11px] leading-none font-bold sm:hidden">
                    ?
                  </span>
                ) : null}
                <span aria-hidden className="mt-auto hidden items-center gap-1.5 text-[10px] font-bold text-orange-ink sm:flex">
                  {day.overtimeHours > 0 && day.workHalfDays > 0 ? <span>+{day.overtimeHours}h</span> : null}
                  {day.onCall ? <Zap className="size-3" strokeWidth={2.5} /> : null}
                  {day.comment ? <MessageSquare className="size-3 text-ink-subtle" strokeWidth={2.5} /> : null}
                  {hasIssue ? <TriangleAlert className="ml-auto size-3.5 text-danger" strokeWidth={2.5} /> : null}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function GridLegend() {
  const items = [
    ["bg-cell-work border-cell-work-line", "Travaillé"],
    ["bg-cell-half border-cell-half-line", "Demi-journée"],
    ["bg-cell-absence border-cell-absence-line", "Absence"],
    ["bg-cell-holiday border-cell-holiday-line", "Férié"],
    ["bg-cell-weekend border-cell-weekend-line", "Week-end"],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-ink-muted">
      {items.map(([cls, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-[11px] rounded-swatch border ${cls}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function formatHalfDays(halfDays: number) {
  return `${formatDays(halfDays)} j`;
}
