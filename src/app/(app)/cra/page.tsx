import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CraEditor } from "@/components/cra/cra-editor";
import { craHref } from "@/lib/cra-links";
import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/skeletons";
import { StatusPill } from "@/components/ui/status-pill";
import { requireRole, type CurrentUser } from "@/lib/auth/dal";
import { closingPeriod, formatMonth, isoDate, shiftMonth, todayIso } from "@/lib/domain/calendar";
import { formatDays, formatEur } from "@/lib/domain/timesheet";
import { ROUTES } from "@/lib/navigation";
import { listTimesheets } from "@/lib/queries/cra";
import { loadCraEditor } from "@/lib/queries/cra-editor";

export const metadata: Metadata = { title: ROUTES.cra.head.title };

type SearchParams = Promise<{ mois?: string | string[]; po?: string | string[] }>;

export default function CraPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CraContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CraContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireRole(ROUTES.cra.roles);
  if (user.role !== "FREELANCE") return <AdminList user={user} />;

  const params = await searchParams;
  const today = todayIso();
  const { year, month1 } = parseMonth(first(params.mois), today);
  const [data, history] = await Promise.all([loadCraEditor(user, year, month1, first(params.po), today), listTimesheets(user)]);

  return (
    <>
      <PageHeader route="cra" />
      {!data ? (
        <Empty>Votre compte n&apos;est rattaché à aucune fiche freelance. Contactez votre administrateur.</Empty>
      ) : data.editor ? (
        <CraEditor
          key={`${data.editor.poId}-${year}-${month1}-${data.editor.status}`}
          data={{ ...data, editor: data.editor }}
          today={today}
        />
      ) : (
        <Empty>
          Aucun contrat actif en {formatMonth(year, month1)}.{" "}
          {data.nav.prev ? (
            <Link href={craHref(data.nav.prev)} className="font-semibold text-purple underline">
              Voir le mois précédent
            </Link>
          ) : null}
        </Empty>
      )}
      <TimesheetTable title="Historique" rows={history} linkRows />
    </>
  );
}

async function AdminList({ user }: { user: CurrentUser }) {
  const rows = await listTimesheets(user);
  const period = closingPeriod(todayIso());
  const months = [period, shiftMonth(period.year, period.month1, -1)].map((m) => ({
    key: isoDate(m.year, m.month1, 1).slice(0, 7),
    label: formatMonth(m.year, m.month1),
  }));
  return (
    <>
      <PageHeader
        route="cra"
        title="Détail CRA"
        actions={months.map((m) => (
          <a
            key={m.key}
            href={`/api/exports/monthly?mois=${m.key}`}
            className="flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-[12.5px] font-semibold text-ink-3 hover:bg-surface-soft"
          >
            Export Excel {m.label}
          </a>
        ))}
      />
      <TimesheetTable title="Derniers CRA" rows={rows} showFreelancer documents />
    </>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** "?mois=2026-10" ; à défaut, la période de clôture en cours. */
function parseMonth(value: string | undefined, today: string) {
  const m = value?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) return { year: Number(m[1]), month1: Number(m[2]) };
  const p = closingPeriod(today);
  return { year: p.year, month1: p.month1 };
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 rounded-card border border-line bg-surface p-6 text-[13.5px] text-ink-muted shadow-card">{children}</p>
  );
}

function TimesheetTable({
  title,
  rows,
  showFreelancer = false,
  linkRows = false,
  documents = false,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listTimesheets>>;
  showFreelancer?: boolean;
  linkRows?: boolean;
  documents?: boolean;
}) {
  const th = "px-3 py-2.5";
  return (
    <section
      aria-labelledby="historique-titre"
      className="mt-6 overflow-hidden rounded-card border border-line bg-surface shadow-card"
    >
      <h2 id="historique-titre" className="px-5 pt-4 pb-3 text-[15.5px] font-bold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-[13.5px] text-ink-muted">Aucun CRA pour le moment.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-soft text-[11px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">
              <tr>
                <th scope="col" className="px-5 py-2.5">
                  Mois
                </th>
                {showFreelancer && (
                  <th scope="col" className={th}>
                    Freelance
                  </th>
                )}
                <th scope="col" className={th}>
                  Mission · PO
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Jours
                </th>
                <th scope="col" className={`${th} text-right`}>
                  H. sup.
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Astreintes
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Montant HT
                </th>
                <th scope="col" className="px-5 py-2.5">
                  Statut
                </th>
                {documents ? (
                  <th scope="col" className="px-5 py-2.5">
                    <span className="sr-only">Documents</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => {
                const y = r.month.getUTCFullYear();
                const m = r.month.getUTCMonth() + 1;
                const label = formatMonth(y, m);
                return (
                  <tr key={r.id} className="border-t border-line-faint">
                    <td className="px-5 py-3 font-semibold capitalize">
                      {linkRows ? (
                        <Link
                          href={craHref(isoDate(y, m, 1).slice(0, 7), r.purchaseOrderId)}
                          className="text-purple underline-offset-2 hover:underline"
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    {showFreelancer && <td className="px-3 py-3">{r.freelancer.user.name}</td>}
                    <td className="px-3 py-3">
                      {r.purchaseOrder.mission.name}
                      <span className="block text-xs text-ink-subtle">{r.purchaseOrder.number}</span>
                    </td>
                    <td className="px-3 py-3 text-right">{formatDays(r.totalWorkHalfDays)} j</td>
                    <td className="px-3 py-3 text-right">{r.totalOvertimeHours} h</td>
                    <td className="px-3 py-3 text-right">{r.totalOnCall}</td>
                    <td className="px-3 py-3 text-right font-semibold">{formatEur(r.totalAmountCents)}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    {documents ? (
                      <td className="px-5 py-3">
                        {r.status === "DRAFT" ? null : (
                          <a
                            href={`/api/cra/${encodeURIComponent(r.id)}/pdf`}
                            target="_blank"
                            rel="noopener"
                            className="font-semibold text-purple underline-offset-2 hover:underline"
                          >
                            PDF
                            <span className="sr-only">
                              {" "}
                              du CRA de {r.freelancer.user.name}, {label} (nouvel onglet)
                            </span>
                          </a>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
