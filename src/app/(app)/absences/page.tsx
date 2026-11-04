import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { CancelAbsenceButton, DeclareAbsenceForm } from "@/components/absences/forms";
import { formatIsoDate } from "@/components/referential/ui";
import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/skeletons";
import { requireRole, type CurrentUser } from "@/lib/auth/dal";
import { ABSENCE_LABELS, absenceWorkingDays, ganttBar, type AbsenceKind } from "@/lib/domain/absences";
import { formatLongDate, formatMonth, isoDate, shiftMonth, todayIso } from "@/lib/domain/calendar";
import { ROUTES } from "@/lib/navigation";
import { absenceBoard, myAbsences } from "@/lib/queries/absences";

export const metadata: Metadata = { title: ROUTES.absences.head.title };

type SearchParams = Promise<{ mois?: string | string[] }>;

export default function AbsencesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader route="absences" />
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const card = "rounded-card border border-line bg-surface p-5 shadow-card";
const BAR: Record<AbsenceKind, string> = { LEAVE: "bg-gradient-primary", UNAVAILABLE: "bg-cyan-ink", SICK: "bg-orange-ink" };
const TAG: Record<AbsenceKind, string> = {
  LEAVE: "bg-lavender-light text-purple",
  UNAVAILABLE: "bg-info-bg text-cyan-ink",
  SICK: "bg-warning-bg text-orange-ink",
};
/** Seuil d'absence (part de la capacité) au-delà duquel un arbitrage est suggéré */
const CAPACITY_WARNING = 0.2;

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireRole(ROUTES.absences.roles);
  const today = todayIso();
  const raw = (await searchParams).mois;
  const m = (Array.isArray(raw) ? raw[0] : raw)?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  const year = m ? Number(m[1]) : Number(today.slice(0, 4));
  const month1 = m ? Number(m[2]) : Number(today.slice(5, 7));
  const key = (y: number, mo: number) => isoDate(y, mo, 1).slice(0, 7);
  const prev = shiftMonth(year, month1, -1);
  const next = shiftMonth(year, month1, 1);
  const freelance = user.role === "FREELANCE";

  const [board, mine] = await Promise.all([absenceBoard(user, year, month1), freelance ? myAbsences(user) : Promise.resolve([])]);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <nav aria-label="Mois" className="flex items-center gap-2">
        <Link href={`/absences?mois=${key(prev.year, prev.month1)}`} aria-label="Mois précédent" className="grid size-11 place-items-center rounded-control border border-line-strong bg-surface">
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
        <span className="min-w-36 text-center text-[15.5px] font-bold capitalize">{formatMonth(year, month1)}</span>
        <Link href={`/absences?mois=${key(next.year, next.month1)}`} aria-label="Mois suivant" className="grid size-11 place-items-center rounded-control border border-line-strong bg-surface">
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </nav>

      <div className={`grid items-start gap-4 ${freelance ? "min-[1100px]:grid-cols-[minmax(0,1fr)_380px]" : "min-[1100px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"}`}>
        <Gantt rows={board.rows} year={year} month1={month1} user={user} />
        {freelance ? <Declarations absences={mine} today={today} /> : <Capacity capacity={board.capacity} />}
      </div>
    </div>
  );
}

function Gantt({ rows, year, month1, user }: { rows: Awaited<ReturnType<typeof absenceBoard>>["rows"]; year: number; month1: number; user: CurrentUser }) {
  return (
    <section aria-labelledby="gantt-titre" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="gantt-titre" className="text-[15.5px] font-bold">
          {user.role === "FREELANCE" ? "Mes absences du mois" : "Plan des absences"}
        </h2>
        <ul className="flex flex-wrap gap-3 text-[11px] text-ink-muted">
          {(Object.keys(ABSENCE_LABELS) as AbsenceKind[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-[11px] rounded-swatch ${BAR[k]}`} />
              {ABSENCE_LABELS[k]}
            </li>
          ))}
        </ul>
      </div>
      {rows.length === 0 ? <p className="mt-3 text-[13px] text-ink-muted">Aucun freelance en mission ce mois-ci.</p> : null}
      <ul className="mt-4 flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.id} className="grid items-center gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{r.name}</p>
              <p className="truncate text-[11px] text-ink-subtle">{r.missions}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="relative h-6 overflow-hidden rounded-[8px] bg-line-faint">
                {r.absences.map((a) => {
                  const bar = ganttBar(a, year, month1);
                  if (!bar) return null;
                  // Jours ouvrés (hors week-end) dans le mois affiché
                  const days = absenceWorkingDays(a, year, month1, new Set()).length;
                  return (
                    <div
                      key={a.id}
                      title={`${ABSENCE_LABELS[a.kind]} du ${formatLongDate(a.start)} au ${formatLongDate(a.end)}`}
                      style={{ left: `min(${bar.left}%, calc(100% - 1.25rem))`, width: `${bar.width}%` }}
                      className={`absolute inset-y-0 flex min-w-5 items-center justify-center overflow-hidden rounded-[8px] text-[10.5px] font-bold text-white ${BAR[a.kind]}`}
                    >
                      <span aria-hidden>{days} j</span>
                    </div>
                  );
                })}
              </div>
              {/* Équivalent textuel du diagramme */}
              {r.absences.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {r.absences.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${TAG[a.kind]}`}>
                        {ABSENCE_LABELS[a.kind]} · {formatIsoDate(a.start)} → {formatIsoDate(a.end)}
                      </span>
                      {user.role === "ADMIN" ? <CancelAbsenceButton id={a.id} label={`l'absence de ${r.name} du ${formatIsoDate(a.start)}`} /> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-ink-subtle">Aucune absence</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Capacity({ capacity }: { capacity: Awaited<ReturnType<typeof absenceBoard>>["capacity"] }) {
  const tense = capacity.filter((c) => c.ratio >= CAPACITY_WARNING || c.overlaps.length > 0);
  return (
    <section aria-labelledby="capa-titre" className={card}>
      <h2 id="capa-titre" className="text-[15.5px] font-bold">
        Impact capacitaire
      </h2>
      {capacity.length === 0 ? <p className="mt-2 text-[13px] text-ink-muted">Aucune mission en cours.</p> : null}
      <ul className="mt-3 flex flex-col gap-2.5">
        {capacity.map((c) => (
          <li key={c.id} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-[13px]">
              <span className="font-semibold">{c.name}</span>
              <span className="tabular-nums">
                {c.absentDays} j absents / {c.capacityDays} j ({Math.round(c.ratio * 100)} %)
              </span>
            </div>
            <div aria-hidden className="h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
              <div className={`h-full rounded-pill ${c.ratio >= CAPACITY_WARNING ? "bg-orange" : "bg-purple"}`} style={{ width: `${Math.min(100, c.ratio * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {tense.length > 0 ? (
        <div className="mt-4 rounded-control bg-warning-bg px-3 py-2.5 text-[12.5px] text-warning">
          <p className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert aria-hidden className="size-4" /> Arbitrage à prévoir
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
            {tense.map((c) => (
              <li key={c.id}>
                {c.name} :{" "}
                {c.overlaps.length > 0
                  ? `${c.overlaps.length} jour${c.overlaps.length > 1 ? "s" : ""} avec plusieurs absents (dès le ${formatLongDate(c.overlaps[0].date)} : ${c.overlaps[0].names.join(", ")})`
                  : `${Math.round(c.ratio * 100)} % de la capacité absente`}
                .
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Declarations({ absences, today }: { absences: Awaited<ReturnType<typeof myAbsences>>; today: string }) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="declarer" className={card}>
        <h2 id="declarer" className="mb-3 text-[15.5px] font-bold">
          Déclarer une absence
        </h2>
        <DeclareAbsenceForm />
      </section>
      <section aria-labelledby="mes-absences" className={card}>
        <h2 id="mes-absences" className="text-[15.5px] font-bold">
          Mes absences déclarées
        </h2>
        {absences.length === 0 ? <p className="mt-2 text-[13px] text-ink-muted">Aucune absence déclarée.</p> : null}
        <ul className="mt-3 flex flex-col gap-3">
          {absences.map((a) => (
            <li key={a.id} className="flex flex-col gap-1.5 border-b border-line-faint pb-3 last:border-0">
              <p className="text-[13px]">
                <span className={`mr-2 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${TAG[a.kind]}`}>{ABSENCE_LABELS[a.kind]}</span>
                {formatIsoDate(a.start)} → {formatIsoDate(a.end)}
              </p>
              {a.comment ? <p className="text-[12px] text-ink-subtle">{a.comment}</p> : null}
              {a.start > today ? <CancelAbsenceButton id={a.id} label={`l'absence du ${formatIsoDate(a.start)}`} /> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
