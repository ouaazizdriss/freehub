import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/skeletons";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/status-pill";
import { BulkValidate } from "@/components/validation/bulk-validate";
import { DecisionPanel } from "@/components/validation/decision-panel";
import { requireRole } from "@/lib/auth/dal";
import { validationHref } from "@/lib/cra-links";
import { formatMonth } from "@/lib/domain/calendar";
import { formatDays, formatEur } from "@/lib/domain/timesheet";
import { ROUTES } from "@/lib/navigation";
import {
  canDecide,
  getValidationDetail,
  listQueue,
  QUEUE_FILTERS,
  queueCounts,
  type QueueFilter,
  type QueueRow,
} from "@/lib/queries/validation";

export const metadata: Metadata = { title: ROUTES.validation.head.title };

type SearchParams = Promise<{ statut?: string | string[]; cra?: string | string[] }>;

export default function ValidationPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader route="validation" />
      <Suspense fallback={<PageSkeleton />}>
        <ValidationContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isFilter = (v: string | undefined): v is QueueFilter => !!v && Object.hasOwn(QUEUE_FILTERS, v);

async function ValidationContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireRole(ROUTES.validation.roles);
  const params = await searchParams;
  const filterParam = first(params.statut);
  const filter: QueueFilter = isFilter(filterParam) ? filterParam : "SUBMITTED";

  const [counts, rows] = await Promise.all([queueCounts(user), listQueue(user, filter)]);
  const requested = first(params.cra);
  const selectedId = requested ?? rows[0]?.id;
  const detail = selectedId ? await getValidationDetail(user, selectedId) : null;
  const index = rows.findIndex((r) => r.id === detail?.id);
  // Après une décision, on passe au CRA suivant de la file (ou au précédent en fin de liste).
  const nextId = index >= 0 ? (rows[index + 1]?.id ?? rows[index - 1]?.id ?? null) : (rows[0]?.id ?? null);
  const decider = canDecide(user);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <nav aria-label="Statut" className="flex flex-wrap gap-2">
        {(Object.keys(QUEUE_FILTERS) as QueueFilter[]).map((f) => (
          <Link
            key={f}
            href={validationHref(f)}
            aria-current={f === filter ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-pill border px-4 text-[12.5px] font-semibold ${
              f === filter
                ? "border-purple bg-purple text-white"
                : "border-line-strong bg-surface text-ink-3 hover:bg-surface-soft"
            }`}
          >
            {QUEUE_FILTERS[f].label}
            <span className={`tabular-nums ${f === filter ? "text-white" : "text-ink-subtle"}`}>{counts[f]}</span>
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="file-titre" className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
            <h2 id="file-titre" className="text-[15.5px] font-bold">
              {QUEUE_FILTERS[filter].label}
            </h2>
            <span className="rounded-pill bg-pink-ink px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
              {counts[filter]}
            </span>
            {counts[filter] > rows.length ? (
              <span className="text-[12px] text-ink-subtle">
                {rows.length} premiers affichés sur {counts[filter]}
              </span>
            ) : null}
            {decider && filter === "SUBMITTED" && rows.length > 0 ? (
              <div className="ml-auto">
                <BulkValidate count={counts.SUBMITTED} />
              </div>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <p className="px-5 pb-6 text-[13.5px] text-ink-muted">
              {filter === "SUBMITTED" ? "Aucun CRA en attente de validation." : "Aucun CRA dans cette liste."}
            </p>
          ) : (
            <QueueTable rows={rows} filter={filter} selectedId={detail?.id} />
          )}
        </section>

        <aside className="min-[1100px]:sticky min-[1100px]:top-5">
          {detail ? (
            <DecisionPanel
              key={detail.id}
              detail={detail}
              canDecide={decider}
              nextHref={nextId && nextId !== detail.id ? validationHref(filter, nextId) : validationHref(filter)}
            />
          ) : (
            <div className="rounded-card border border-line bg-surface p-5 text-[13px] text-ink-muted shadow-card">
              {requested ? "CRA introuvable ou hors de votre périmètre." : "Sélectionnez un CRA dans la liste."}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function QueueTable({ rows, filter, selectedId }: { rows: QueueRow[]; filter: QueueFilter; selectedId?: string }) {
  const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Africa/Casablanca" });
  const th = "px-3 py-2.5";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-surface-soft text-[11px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">
          <tr>
            <th scope="col" className="px-5 py-2.5">
              Freelance
            </th>
            <th scope="col" className={th}>
              Mission
            </th>
            <th scope="col" className={th}>
              Mois
            </th>
            <th scope="col" className={`${th} text-right`}>
              Jours
            </th>
            <th scope="col" className={`${th} text-right`}>
              HS
            </th>
            <th scope="col" className={`${th} text-right`}>
              Montant
            </th>
            {filter !== "SUBMITTED" ? (
              <th scope="col" className="px-5 py-2.5">
                Statut
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => {
            const selected = r.id === selectedId;
            const name = r.freelancer.user.name;
            return (
              <tr
                key={r.id}
                className={`relative border-t border-line-faint ${selected ? "bg-lavender-light" : "hover:bg-surface-soft"}`}
              >
                <td className="px-5 py-2.5">
                  <Link
                    href={validationHref(filter, r.id)}
                    aria-current={selected ? "true" : undefined}
                    className="flex items-center gap-2.5 rounded-control font-semibold after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pink-ink"
                  >
                    <Avatar name={name} size={32} active={selected} />
                    <span className="flex flex-col">
                      <span>
                        {name}
                        <span className="sr-only">
                          {" "}
                          — {r.purchaseOrder.mission.name}, {formatMonth(r.month.getUTCFullYear(), r.month.getUTCMonth() + 1)}
                        </span>
                      </span>
                      <span className="text-[11.5px] font-normal text-ink-subtle">
                        {r.submittedAt ? `Déposé le ${dateFmt.format(r.submittedAt)}` : "—"}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  {r.purchaseOrder.mission.name}
                  <span className="block text-xs text-ink-subtle">{r.purchaseOrder.number}</span>
                </td>
                <td className="px-3 py-2.5 capitalize">{formatMonth(r.month.getUTCFullYear(), r.month.getUTCMonth() + 1)}</td>
                <td className="px-3 py-2.5 text-right">{formatDays(r.totalWorkHalfDays)} j</td>
                <td className={`px-3 py-2.5 text-right ${r.totalOvertimeHours > 6 ? "font-semibold text-orange-ink" : ""}`}>
                  {r.totalOvertimeHours} h
                </td>
                <td className="px-3 py-2.5 text-right font-semibold">{formatEur(r.totalAmountCents)}</td>
                {filter !== "SUBMITTED" ? (
                  <td className="px-5 py-2.5">
                    <StatusPill status={r.status} />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
