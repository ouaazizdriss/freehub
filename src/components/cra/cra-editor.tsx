"use client";

import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { submitTimesheet, type ActionError } from "@/app/(app)/cra/actions";
import { StatusPill } from "@/components/ui/status-pill";
import { craHref } from "@/lib/cra-links";
import { formatMonth, isWeekend, monthDates, type IsoDate } from "@/lib/domain/calendar";
import {
  applyKindToDates,
  checkSubmission,
  DAY_KIND_LABELS,
  emptyDay,
  inPeriod,
  isBlank,
  issueMessage,
  weekTargets,
  withKind,
  type DayKind,
  type EditableDay,
  type Period,
  type SubmissionIssue,
} from "@/lib/domain/cra-editor";
import { computeTotals, formatEur, type Rates } from "@/lib/domain/timesheet";
import type { CraEditorData } from "@/lib/queries/cra-editor";
import { DayGrid, formatHalfDays, GridLegend, type HolidayInfo } from "./day-grid";
import { DayPanel } from "./day-panel";
import { SignatureCard } from "./signature-card";
import { useAutosave, type SaveState } from "./use-autosave";

type Props = {
  data: CraEditorData & { editor: NonNullable<CraEditorData["editor"]> };
  today: IsoDate;
};

const EDITABLE = new Set(["DRAFT", "REJECTED"]);
const STATUS_SHORT = { DRAFT: "Brouillon", SUBMITTED: "Soumis", VALIDATED: "Validé", REJECTED: "À corriger" } as const;

export function CraEditor({ data, today }: Props) {
  const { year, month1, editor } = data;
  const router = useRouter();
  const month = `${year}-${String(month1).padStart(2, "0")}`;
  // Mois futur : consultation seule (le serveur refuse aussi toute écriture).
  const editable = EDITABLE.has(editor.status) && !editor.future;
  const dates = useMemo(() => monthDates(year, month1), [year, month1]);
  const holidays = useMemo(
    () => new Map<IsoDate, HolidayInfo>(editor.holidays.map((h) => [h.date, { label: h.label, tentative: h.tentative }])),
    [editor.holidays],
  );
  const holidaySet = useMemo(() => new Set(holidays.keys()), [holidays]);

  const [days, setDays] = useState(() => new Map(editor.days.map((d) => [d.date, d])));
  const [selected, setSelected] = useState<IsoDate>(() => initialSelection(dates, editor.periods, holidaySet, today));
  const [weekFeedback, setWeekFeedback] = useState<string | null>(null);
  /** Annonces lecteur d'écran (raccourcis clavier, choix depuis le récapitulatif) */
  const [announcement, setAnnouncement] = useState("");
  const autosave = useAutosave({
    ownerId: editor.ownerId,
    timesheetId: editor.timesheetId,
    poId: editor.poId,
    month,
    initialVersion: editor.version,
    enabled: editable,
    // Modifications faites hors ligne lors d'une visite précédente, reprises si le CRA n'a pas changé depuis.
    onRestore: (restored) => setDays(new Map(restored.map((d) => [d.date, d]))),
  });

  const values = useMemo(() => [...days.values()], [days]);
  const totals = useMemo(() => computeTotals(values, editor.rates), [values, editor.rates]);
  const check = useMemo(
    () =>
      checkSubmission(values, {
        year,
        month1,
        holidays: holidaySet,
        periods: editor.periods,
        mixedRates: editor.mixedRates,
        hasSignature: !!data.signature,
        poRemainingHalfDays: editor.poRemainingHalfDays,
        today,
      }),
    [values, year, month1, holidaySet, editor.periods, editor.mixedRates, editor.poRemainingHalfDays, today, data.signature],
  );
  const issueDates = useMemo(() => new Set(check.errors.flatMap((i) => (i.date ? [i.date] : []))), [check]);
  const workingDayCount = dates.filter((d) => !isWeekend(d) && !holidaySet.has(d) && inPeriod(d, editor.periods)).length;

  const commit = (next: Map<IsoDate, EditableDay>) => {
    setDays(next);
    autosave.schedule([...next.values()]);
  };

  const updateDay = (day: EditableDay) => {
    if (!editable || !inPeriod(day.date, editor.periods)) return false;
    const next = new Map(days);
    if (isBlank(day)) next.delete(day.date);
    else next.set(day.date, day);
    setWeekFeedback(null);
    commit(next);
    return true;
  };

  const applyKind = (kind: DayKind) => {
    const date = shortDate(selected);
    if (!editable) return setAnnouncement("Ce CRA n'est pas modifiable.");
    if (!inPeriod(selected, editor.periods)) return setAnnouncement(`${date} : hors période du contrat, saisie impossible.`);
    updateDay(withKind(days.get(selected) ?? emptyDay(selected), kind));
    setAnnouncement(`${date} : ${DAY_KIND_LABELS[kind]}.`);
  };

  const selectFromRecap = (date: IsoDate) => {
    setSelected(date);
    setWeekFeedback(null);
    // Le dialogue vient de se fermer : on rend le focus à la cellule concernée.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus());
  };

  const declared = useMemo(() => new Set(editor.declaredAbsences), [editor.declaredAbsences]);
  const pendingAbsences = editor.declaredAbsences.filter((d) => (days.get(d)?.workHalfDays ?? 0) + (days.get(d)?.absenceHalfDays ?? 0) === 0);
  /** Reporte les absences déclarées sur les jours encore vides (jamais sur un jour déjà saisi). */
  const applyDeclaredAbsences = () => {
    const next = new Map(days);
    for (const d of pendingAbsences) next.set(d, withKind(next.get(d) ?? emptyDay(d), "absence"));
    commit(next);
    setAnnouncement(`${pendingAbsences.length} jour${pendingAbsences.length > 1 ? "s" : ""} d'absence reporté${pendingAbsences.length > 1 ? "s" : ""}.`);
  };

  const applyWeek = () => {
    const source = days.get(selected) ?? emptyDay(selected);
    const targets = weekTargets(selected, dates, holidaySet, editor.periods);
    const next = applyKindToDates(days, targets, source);
    for (const d of targets) if (isBlank(next.get(d)!)) next.delete(d);
    commit(next);
    setWeekFeedback(`Appliqué à ${targets.length} jour${targets.length > 1 ? "s" : ""} ouvré${targets.length > 1 ? "s" : ""}.`);
  };

  const go = async (href: string) => {
    const saved = await autosave.flush();
    if (!saved && autosave.hasUnsaved() && !window.confirm("Vos dernières modifications ne sont pas enregistrées. Quitter quand même ?")) return;
    router.push(href);
  };

  const selectedDay = days.get(selected) ?? emptyDay(selected);
  const rateLabel = `TJM ${formatEur(editor.rates.dailyRateCents, editor.currency)}`;

  return (
    <div className="mt-5 flex flex-col gap-4">
      {/* Vue mobile : synthèse du mois en tête (design distinct du desktop, cf. handoff « Vue mobile ») */}
      <div className="rounded-card bg-gradient-primary px-5 py-4 text-white shadow-cta md:hidden">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold capitalize opacity-90">{formatMonth(year, month1)}</p>
          <span className="rounded-pill bg-white px-2.5 py-0.5 text-[11px] font-bold text-purple">{STATUS_SHORT[editor.status]}</span>
        </div>
        <p className="mt-1 text-[21px] font-extrabold tabular-nums">{formatEur(totals.amountCents, editor.currency)}</p>
        <p className="text-[12px] opacity-90">
          {formatHalfDays(totals.workHalfDays)} travaillés · {totals.overtimeHours} h sup. · {totals.onCall} astreinte{totals.onCall > 1 ? "s" : ""}
        </p>
      </div>
      <Toolbar
        month={month}
        label={formatMonth(year, month1)}
        nav={data.nav}
        choices={data.choices}
        poId={editor.poId}
        status={editor.status}
        saveState={autosave.state}
        onNavigate={go}
        onRetry={() => void autosave.flush()}
        documents={
          editor.timesheetId ? <DocumentLinks timesheetId={editor.timesheetId} prepare={autosave.flush} /> : null
        }
        submit={
          <SubmitButton
            status={editor.status}
            onSubmitted={() => router.refresh()}
            prepare={autosave.flush}
            getVersion={autosave.getVersion}
            poId={editor.poId}
            month={month}
            check={check}
            totals={totals}
            currency={editor.currency}
            onSelectDate={selectFromRecap}
          />
        }
      />

      <StatusBanner editor={editor} saveState={autosave.state} onReload={() => window.location.reload()} />
      {autosave.offlineNotice ? (
        <p role="status" className="rounded-control bg-info-bg px-4 py-3 text-[13px] text-cyan-ink">
          {autosave.offlineNotice}
        </p>
      ) : null}

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_322px]">
        {/* Mobile : marges réduites pour des cases d'au moins 44 px de large à 375 px */}
        <section aria-labelledby="grille-titre" className="rounded-card border border-line bg-surface p-2 shadow-card sm:p-5">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 px-1 pt-1 sm:px-0 sm:pt-0">
            <h2 id="grille-titre" className="text-[15.5px] font-bold">
              Grille de saisie
            </h2>
            <GridLegend />
          </div>
          <DayGrid
            year={year}
            month1={month1}
            days={days}
            holidays={holidays}
            periods={editor.periods}
            selected={selected}
            issueDates={issueDates}
            onSelect={(d) => {
              setSelected(d);
              setWeekFeedback(null);
            }}
            onShortcut={applyKind}
            declared={declared}
          />
          {editable && pendingAbsences.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-control bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
              <span>
                {pendingAbsences.length} jour{pendingAbsences.length > 1 ? "s" : ""} d&apos;absence déclarée{pendingAbsences.length > 1 ? "s" : ""} non
                reporté{pendingAbsences.length > 1 ? "s" : ""} (cases « Abs. ? »).
              </span>
              <button type="button" onClick={applyDeclaredAbsences} className="min-h-11 rounded-control border border-warning px-3 font-semibold">
                Reporter mes absences
              </button>
            </div>
          ) : null}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
          {editable ? (
            <p className="mt-3 text-[11.5px] text-ink-subtle">
              Clavier : flèches pour changer de jour,{" "}
              <kbd className="font-semibold">J</kbd> journée, <kbd className="font-semibold">D</kbd> demi-journée,{" "}
              <kbd className="font-semibold">A</kbd> absence, <kbd className="font-semibold">N</kbd> non travaillé.
            </p>
          ) : null}
          <dl className="mt-4 flex flex-wrap gap-2.5 border-t border-line-soft pt-4">
            <Tile label="Jours travaillés" value={formatHalfDays(totals.workHalfDays)} />
            <Tile label="Jours ouvrés" value={String(workingDayCount)} />
            <Tile label="Absences" value={formatHalfDays(totals.absenceHalfDays)} className="text-warning" />
            <Tile label="Heures sup." value={`${totals.overtimeHours} h`} className="text-orange-ink" />
            <Tile label="Astreintes" value={String(totals.onCall)} className="text-purple" />
          </dl>
        </section>

        <aside className="flex flex-col gap-4 min-[1100px]:sticky min-[1100px]:top-5">
          <div className="rounded-card border border-line bg-surface px-5 py-[18px] shadow-card">
            <DayPanel
              day={selectedDay}
              holiday={holidays.get(selected)}
              weekend={isWeekend(selected)}
              inContract={inPeriod(selected, editor.periods)}
              editable={editable}
              issues={check.errors.filter((i) => i.date === selected)}
              missionName={editor.missionName}
              poNumber={editor.poNumber}
              rateLabel={rateLabel}
              weekFeedback={weekFeedback}
              onChange={updateDay}
              onApplyWeek={applyWeek}
            />
          </div>
          <SignatureCard signature={data.signature} />
          <AmountCard totals={totals} rates={editor.rates} currency={editor.currency} poRemainingHalfDays={editor.poRemainingHalfDays} />
        </aside>
      </div>
    </div>
  );
}

function initialSelection(dates: IsoDate[], periods: readonly Period[], holidays: Set<IsoDate>, today: IsoDate) {
  if (dates.includes(today) && inPeriod(today, periods)) return today;
  return dates.find((d) => inPeriod(d, periods) && !isWeekend(d) && !holidays.has(d)) ?? dates[0];
}

const shortDate = (date: IsoDate) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

function Tile({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex min-w-[118px] flex-1 flex-col gap-0.5 rounded-cell bg-surface-soft px-3 py-2.5">
      <dt className="text-[10.5px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">{label}</dt>
      <dd className={`text-[17px] font-bold tabular-nums ${className}`}>{value}</dd>
    </div>
  );
}

function AmountCard({
  totals,
  rates,
  currency,
  poRemainingHalfDays,
}: {
  totals: ReturnType<typeof computeTotals>;
  rates: Rates;
  currency: string;
  poRemainingHalfDays: number;
}) {
  const eur = (c: number) => formatEur(c, currency);
  const after = poRemainingHalfDays - totals.workHalfDays;
  return (
    <div className="rounded-card bg-cell-half px-5 py-4">
      <p className="text-[11.5px] font-semibold text-cell-half-ink">Montant estimé HT</p>
      <p className="text-[27px] font-extrabold tracking-[-0.02em] text-purple-deep tabular-nums">{eur(totals.amountCents)}</p>
      <p className="text-[11.5px] text-ink-3">
        {formatHalfDays(totals.workHalfDays)} × {eur(rates.dailyRateCents)}
        {totals.overtimeHours > 0 ? ` + ${totals.overtimeHours} h × ${eur(rates.overtimeHourlyRateCents)}` : ""}
        {totals.onCall > 0 ? ` + ${totals.onCall} astreinte${totals.onCall > 1 ? "s" : ""} × ${eur(rates.onCallRateCents)}` : ""}
      </p>
      <p className={`mt-2 text-[11.5px] font-semibold ${after < 0 ? "text-danger" : "text-ink-3"}`}>
        Reste sur le bon de commande après ce CRA : {formatHalfDays(after)}
      </p>
    </div>
  );
}

function Toolbar(props: {
  month: string;
  label: string;
  nav: { prev: string | null; next: string | null };
  choices: { poId: string; label: string }[];
  poId: string;
  status: Props["data"]["editor"]["status"];
  saveState: SaveState;
  onNavigate: (href: string) => void;
  onRetry: () => void;
  documents: React.ReactNode;
  submit: React.ReactNode;
}) {
  const typing = useTextFocus();
  const navButton = (target: string | null, dir: "prev" | "next") => {
    const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
    const text = dir === "prev" ? "Mois précédent" : "Mois suivant";
    if (!target)
      return (
        <span aria-hidden className="grid size-11 place-items-center rounded-control text-ink-faint">
          <Icon className="size-4" />
        </span>
      );
    const href = craHref(target);
    return (
      <a
        href={href}
        aria-label={text}
        onClick={(e) => {
          e.preventDefault();
          props.onNavigate(href);
        }}
        className="grid size-11 place-items-center rounded-control border border-line-strong bg-surface hover:bg-surface-soft"
      >
        <Icon className="size-4" />
      </a>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav aria-label="Mois" className="flex items-center gap-2">
        {navButton(props.nav.prev, "prev")}
        <span className="min-w-36 text-center text-[15.5px] font-bold capitalize">{props.label}</span>
        {navButton(props.nav.next, "next")}
      </nav>
      <StatusPill status={props.status} />
      {props.choices.length > 1 ? (
        // Liens plutôt qu'une liste déroulante : changer de mission est une navigation explicite (WCAG 3.2.2).
        <nav aria-label="Mission imputée" className="flex flex-wrap gap-1.5">
          {props.choices.map((c) => {
            const href = craHref(props.month, c.poId);
            const current = c.poId === props.poId;
            return (
              <a
                key={c.poId}
                href={href}
                aria-current={current ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (!current) props.onNavigate(href);
                }}
                className={`flex min-h-11 items-center rounded-control border px-3 text-[12.5px] font-semibold ${
                  current ? "border-purple bg-purple text-white" : "border-line-strong bg-surface text-ink-3 hover:bg-surface-soft"
                }`}
              >
                {c.label}
              </a>
            );
          })}
        </nav>
      ) : null}
      <div className="ml-auto flex items-center gap-3">
        <SaveIndicator state={props.saveState} onRetry={props.onRetry} />
        {props.documents}
        {/* Mobile : bouton de soumission fixé en bas d'écran (zone sûre iOS), masqué pendant la
            saisie d'un texte pour ne pas recouvrir le champ au-dessus du clavier. */}
        <div
          className={`max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-3 max-md:pt-3 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:[&>button]:w-full max-md:[&>button]:justify-center ${
            typing ? "max-md:hidden" : ""
          }`}
        >
          {props.submit}
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const time = (iso: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const content = (() => {
    switch (state.status) {
      case "dirty":
      case "saving":
        return <span className="text-ink-subtle">Enregistrement…</span>;
      case "saved":
        return <span className="text-success">Brouillon enregistré à {time(state.at)}</span>;
      case "error":
        return (
          <span className="text-danger">
            Échec de l&apos;enregistrement.{" "}
            <button type="button" onClick={onRetry} className="font-semibold underline">
              Réessayer
            </button>
          </span>
        );
      case "invalid":
        return <span className="text-danger">Saisie refusée : {state.issues.map(issueMessage).join(" ") || "données invalides."}</span>;
      default:
        return null;
    }
  })();
  // Seules les issues (enregistré, échec) sont annoncées, pas chaque « Enregistrement… ».
  const spoken =
    state.status === "saved"
      ? "Brouillon enregistré."
      : state.status === "error"
        ? "Échec de l'enregistrement."
        : state.status === "invalid"
          ? "Saisie refusée."
          : "";
  return (
    <>
      <p className="text-[12px]">{content}</p>
      <p role="status" className="sr-only">
        {spoken}
      </p>
    </>
  );
}

function StatusBanner({ editor, saveState, onReload }: { editor: Props["data"]["editor"]; saveState: SaveState; onReload: () => void }) {

  if (saveState.status === "conflict" || saveState.status === "locked") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-control bg-danger-bg px-4 py-3 text-[13px] text-danger">
        {saveState.status === "conflict"
          ? "Ce CRA a été modifié ailleurs (autre onglet ou appareil). Vos dernières modifications ne sont pas enregistrées."
          : "Ce CRA n'est plus modifiable (il a été soumis entre-temps)."}
        <button type="button" onClick={onReload} className="rounded-control bg-danger px-3 py-1.5 font-semibold text-white">
          Recharger
        </button>
      </div>
    );
  }
  if (editor.future)
    return (
      <div role="status" className="rounded-control bg-surface-sunken px-4 py-3 text-[13px] text-ink-3">
        Ce mois n&apos;a pas commencé : consultation seule.
      </div>
    );
  if (editor.mixedRates && EDITABLE.has(editor.status))
    return (
      <div role="status" className="rounded-control bg-warning-bg px-4 py-3 text-[13px] text-warning">
        Deux contrats aux taux différents couvrent ce mois sur ce bon de commande. Vous pouvez saisir vos jours ; la soumission
        sera traitée par l&apos;administrateur. Montant estimé au taux du contrat le plus récent.
      </div>
    );
  if (editor.status === "REJECTED")
    return (
      <div role="status" className="rounded-control bg-danger-bg px-4 py-3 text-[13px] text-danger">
        <strong>Correction demandée par le manager.</strong> {editor.rejectionReason}
      </div>
    );
  if (editor.status === "SUBMITTED")
    return (
      <div role="status" className="rounded-control bg-info-bg px-4 py-3 text-[13px] text-cyan-ink">
        Soumis le {editor.submittedAt}, en attente de validation du manager. Le CRA n&apos;est plus modifiable.
      </div>
    );
  if (editor.status === "VALIDATED")
    return (
      <div role="status" className="rounded-control bg-success-bg px-4 py-3 text-[13px] text-success">
        Validé le {editor.validatedAt}.
      </div>
    );
  return null;
}

function SubmitButton(props: {
  status: Props["data"]["editor"]["status"];
  poId: string;
  month: string;
  check: ReturnType<typeof checkSubmission>;
  totals: ReturnType<typeof computeTotals>;
  currency: string;
  prepare: () => Promise<boolean>;
  getVersion: () => number | null;
  onSubmitted: () => void;
  onSelectDate: (date: IsoDate) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<SubmissionIssue[]>([]);

  if (props.status === "SUBMITTED")
    return (
      <button type="button" disabled className="min-h-11 rounded-control bg-surface-sunken px-4 text-[12.5px] font-semibold text-ink-subtle">
        En attente du manager
      </button>
    );
  if (props.status === "VALIDATED")
    return (
      <button type="button" disabled className="min-h-11 rounded-control bg-success-bg px-4 text-[12.5px] font-semibold text-success">
        CRA validé
      </button>
    );

  const errors = serverIssues.length > 0 ? serverIssues : props.check.errors;
  const eur = (c: number) => formatEur(c, props.currency);

  const confirm = () =>
    startTransition(async () => {
      setServerError(null);
      setServerIssues([]);
      const saved = await props.prepare();
      const version = props.getVersion();
      if (!saved || version === null) {
        setServerError("Le brouillon n'a pas pu être enregistré. Réessayez avant de soumettre.");
        return;
      }
      const result = await submitTimesheet({ poId: props.poId, month: props.month, version });
      if (result.ok) {
        dialog.current?.close();
        props.onSubmitted();
        return;
      }
      showError(result);
    });

  const showError = (result: ActionError) => {
    if (result.error === "INVALID") setServerIssues(result.issues);
    else if (result.error === "CONFLICT") setServerError("Le CRA a été modifié ailleurs. Rechargez la page.");
    else if (result.error === "LOCKED") setServerError("Ce CRA a déjà été soumis.");
    else setServerError("CRA introuvable.");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setServerError(null);
          setServerIssues([]);
          dialog.current?.showModal();
        }}
        className="flex min-h-11 items-center gap-2 rounded-control bg-gradient-primary px-4 text-[12.5px] font-semibold text-white shadow-cta"
      >
        <Send className="size-4" />
        Soumettre le CRA
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="recap-titre"
        className="m-auto w-[min(520px,calc(100vw-32px))] rounded-card border border-line bg-surface p-6 shadow-card backdrop:bg-ink/40"
      >
        <h2 id="recap-titre" className="text-[17px] font-bold">
          Soumettre le CRA
        </h2>
        <p className="mt-1 text-[13px] text-ink-muted">Après soumission, le CRA part en validation et n&apos;est plus modifiable.</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-ink-muted">Jours travaillés</dt>
          <dd className="text-right font-semibold tabular-nums">{formatHalfDays(props.totals.workHalfDays)}</dd>
          <dt className="text-ink-muted">Heures sup.</dt>
          <dd className="text-right font-semibold tabular-nums">{props.totals.overtimeHours} h</dd>
          <dt className="text-ink-muted">Astreintes</dt>
          <dd className="text-right font-semibold tabular-nums">{props.totals.onCall}</dd>
          <div aria-hidden className="col-span-2 mt-1 border-t border-line" />
          <dt className="font-semibold">Montant HT</dt>
          <dd className="text-right font-bold text-purple-deep tabular-nums">{eur(props.totals.amountCents)}</dd>
        </dl>

        {errors.length > 0 ? (
          <div className="mt-4 rounded-control bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger">
            <p className="font-semibold">À corriger avant de soumettre :</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
              {errors.map((i, n) => (
                <li key={n}>
                  <IssueText issue={i} onSelect={(d) => (dialog.current?.close(), props.onSelectDate(d))} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {props.check.warnings.length > 0 ? (
          <div className="mt-3 rounded-control bg-warning-bg px-3 py-2.5 text-[12.5px] text-warning">
            <p className="font-semibold">Points d&apos;attention :</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
              {props.check.warnings.map((i, n) => (
                <li key={n}>
                  <IssueText issue={i} onSelect={(d) => (dialog.current?.close(), props.onSelectDate(d))} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {serverError ? (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-danger">
            {serverError}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="min-h-11 rounded-control border border-line-strong px-4 text-[12.5px] font-semibold text-ink-3"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={pending || errors.length > 0}
            onClick={confirm}
            className="min-h-11 rounded-control bg-gradient-primary px-4 text-[12.5px] font-semibold text-white shadow-cta disabled:opacity-50"
          >
            {pending ? "Soumission…" : "Confirmer la soumission"}
          </button>
        </div>
      </dialog>
    </>
  );
}

function IssueText({ issue, onSelect }: { issue: SubmissionIssue; onSelect: (date: IsoDate) => void }) {
  const text = issueMessage(issue);
  if (!issue.date) return <>{text}</>;
  const label = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${issue.date}T00:00:00Z`),
  );
  return (
    <>
      <button type="button" onClick={() => onSelect(issue.date!)} className="font-semibold underline">
        {label}
      </button>{" "}
      : {text}
    </>
  );
}

/** « Voir le PDF » / « Export Excel » : enregistre d'abord la saisie en attente pour que le document soit à jour. */
function DocumentLinks({ timesheetId, prepare }: { timesheetId: string; prepare: () => Promise<boolean> }) {
  const open = async (e: React.MouseEvent<HTMLAnchorElement>, href: string, newTab: boolean) => {
    e.preventDefault();
    // Onglet ouvert pendant le geste utilisateur (sinon bloqué), puis dirigé une fois la saisie enregistrée.
    const tab = newTab ? window.open("about:blank", "_blank") : null;
    let saved = false;
    try {
      saved = await prepare();
    } catch {
      saved = false;
    }
    if (!saved && !window.confirm("La saisie en cours n'est pas enregistrée : le document affichera la dernière version enregistrée. Continuer ?")) {
      tab?.close();
      return;
    }
    if (tab) tab.location.href = href;
    else window.location.href = href;
  };
  const base = `/api/cra/${encodeURIComponent(timesheetId)}`;
  const link = "flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-[12.5px] font-semibold text-ink-3 hover:bg-surface-soft";
  return (
    <>
      <a href={`${base}/xlsx`} onClick={(e) => open(e, `${base}/xlsx`, false)} className={link}>
        <FileSpreadsheet aria-hidden className="size-4" />
        Export Excel
      </a>
      <a href={`${base}/pdf`} target="_blank" rel="noopener" onClick={(e) => open(e, `${base}/pdf`, true)} className={link}>
        <FileText aria-hidden className="size-4" />
        Voir le PDF
        <span className="sr-only"> (nouvel onglet)</span>
      </a>
    </>
  );
}

/** Vrai tant qu'un champ texte a le focus (clavier virtuel ouvert sur mobile). */
function useTextFocus() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isText = (el: EventTarget | null) =>
      el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "file", "button", "submit"].includes(el.type));
    const onIn = (e: FocusEvent) => setTyping(isText(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}
