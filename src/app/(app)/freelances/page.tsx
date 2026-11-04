import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Search } from "lucide-react";
import { ActionForm, Field } from "@/components/forms/action-form";
import { ConsumptionBar, formatIsoDate, FreelancerStatusPill } from "@/components/referential/ui";
import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/skeletons";
import { Avatar } from "@/components/ui/avatar";
import { requireRole } from "@/lib/auth/dal";
import { poHealth, type FreelancerStatus } from "@/lib/domain/alerts";
import { todayIso } from "@/lib/domain/calendar";
import { formatDays, formatEur } from "@/lib/domain/timesheet";
import { ROUTES } from "@/lib/navigation";
import { listFreelancers, listManagers, listMissions, type FreelancerRow } from "@/lib/queries/referential";
import { createMission, createPurchaseOrder } from "./actions";

export const metadata: Metadata = { title: ROUTES.freelances.head.title };

type SearchParams = Promise<{ vue?: string; filtre?: string; q?: string }>;

const FILTERS = {
  ALL: { label: "Tous", test: () => true },
  IN_MISSION: { label: "En mission", test: (r: FreelancerRow) => r.status !== "INACTIVE" },
  ENDING: { label: "Fin < 30 j", test: (r: FreelancerRow) => r.status === "ENDING" },
  DOCS_OK: { label: "Docs à jour", test: (r: FreelancerRow) => r.status !== "DOCS_KO" && r.status !== "INACTIVE" },
  DOCS_KO: { label: "Docs KO", test: (r: FreelancerRow) => r.status === "DOCS_KO" },
} satisfies Record<string, { label: string; test: (r: FreelancerRow) => boolean }>;
type Filter = keyof typeof FILTERS;

export default function FreelancesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader route="freelances" />
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const chip = (active: boolean) =>
  `flex min-h-11 items-center gap-2 rounded-pill border px-4 text-[12.5px] font-semibold ${
    active ? "border-purple bg-purple text-white" : "border-line-strong bg-surface text-ink-3 hover:bg-surface-soft"
  }`;

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireRole(ROUTES.freelances.roles);
  const params = await searchParams;
  const view = one(params.vue) === "missions" ? "missions" : "freelances";
  const editor = user.role === "ADMIN";

  return (
    <div className="mt-5 flex flex-col gap-4">
      <nav aria-label="Vue" className="flex flex-wrap items-center gap-2">
        <Link
          href="/freelances"
          aria-current={view === "freelances" ? "page" : undefined}
          className={chip(view === "freelances")}
        >
          Freelances
        </Link>
        <Link
          href="/freelances?vue=missions"
          aria-current={view === "missions" ? "page" : undefined}
          className={chip(view === "missions")}
        >
          Missions &amp; bons de commande
        </Link>
        {editor && view === "freelances" ? (
          <Link
            href="/freelances/nouveau"
            className="ml-auto flex min-h-11 items-center gap-1.5 rounded-control bg-gradient-primary px-4 text-[12.5px] font-semibold text-white shadow-cta"
          >
            <Plus aria-hidden className="size-4" /> Nouveau freelance
          </Link>
        ) : null}
      </nav>
      {view === "freelances" ? (
        <FreelancerList user={user} filter={one(params.filtre)} q={one(params.q)} />
      ) : (
        <MissionList user={user} editor={editor} />
      )}
    </div>
  );
}

async function FreelancerList({
  user,
  filter: rawFilter,
  q,
}: {
  user: Awaited<ReturnType<typeof requireRole>>;
  filter?: string;
  q?: string;
}) {
  const filter: Filter = rawFilter && Object.hasOwn(FILTERS, rawFilter) ? (rawFilter as Filter) : "ALL";
  const rows = await listFreelancers(user, todayIso());
  const query = (q ?? "").trim().toLowerCase().slice(0, 80);
  const visible = rows.filter(
    (r) =>
      FILTERS[filter].test(r) &&
      (!query || [r.name, r.email, r.missionName ?? "", r.poNumber ?? ""].some((v) => v.toLowerCase().includes(query))),
  );
  const href = (f: Filter) => `/freelances?filtre=${f}${query ? `&q=${encodeURIComponent(query)}` : ""}`;

  return (
    <section aria-labelledby="ref-titre" className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
        <h2 id="ref-titre" className="mr-2 text-[15.5px] font-bold">
          Freelances <span className="text-ink-subtle tabular-nums">({visible.length})</span>
        </h2>
        <nav aria-label="Filtres" className="flex flex-wrap gap-1.5">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <Link
              key={f}
              href={href(f)}
              aria-current={f === filter ? "true" : undefined}
              className={chip(f === filter).replace("px-4", "px-3")}
            >
              {FILTERS[f].label}
            </Link>
          ))}
        </nav>
        <form role="search" action="/freelances" className="ml-auto flex items-center gap-1.5">
          <input type="hidden" name="filtre" value={filter} />
          <label htmlFor="ref-q" className="sr-only">
            Rechercher un freelance, une mission ou un PO
          </label>
          <input
            id="ref-q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Rechercher…"
            className="min-h-11 w-52 rounded-control border border-line-strong px-3 text-[13px]"
          />
          <button
            type="submit"
            aria-label="Rechercher"
            className="grid size-11 place-items-center rounded-control border border-line-strong"
          >
            <Search aria-hidden className="size-4" />
          </button>
        </form>
      </div>
      {visible.length === 0 ? (
        <p className="px-5 pb-6 text-[13.5px] text-ink-muted">Aucun freelance ne correspond.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-soft text-[11px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">
              <tr>
                <th scope="col" className="px-5 py-2.5">
                  Freelance
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Mission · PO
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  TJM
                </th>
                <th scope="col" className="min-w-40 px-3 py-2.5">
                  Consommé PO
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Fin de mission
                </th>
                <th scope="col" className="px-5 py-2.5">
                  Statut
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {visible.map((r) => {
                const health = r.poBudgetHalfDays != null ? poHealth(r.poBudgetHalfDays, r.poConsumedHalfDays ?? 0) : null;
                return (
                  <tr key={r.id} className="relative border-t border-line-faint hover:bg-surface-soft">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/freelances/${r.id}`}
                        className="flex items-center gap-2.5 rounded-control font-semibold after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pink-ink"
                      >
                        <Avatar name={r.name} size={32} />
                        <span className="flex flex-col">
                          {r.name}
                          <span className="text-[11.5px] font-normal text-ink-subtle">{r.jobTitle}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.missionName ?? "—"}
                      {r.poNumber ? <span className="block text-xs text-ink-subtle">{r.poNumber}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.dailyRateCents != null ? formatEur(r.dailyRateCents, r.currency) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {health ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[12px]">
                            {formatDays(r.poConsumedHalfDays ?? 0)} / {formatDays(r.poBudgetHalfDays!)} j (
                            {Math.round(health.ratio * 100)} %)
                          </span>
                          <ConsumptionBar ratio={health.ratio} level={health.level} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5">{formatIsoDate(r.contractEnd)}</td>
                    <td className="px-5 py-2.5">
                      <FreelancerStatusPill status={r.status satisfies FreelancerStatus} />
                    </td>
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

async function MissionList({ user, editor }: { user: Awaited<ReturnType<typeof requireRole>>; editor: boolean }) {
  const [missions, managers] = await Promise.all([listMissions(user), editor ? listManagers() : Promise.resolve([])]);
  return (
    <div className="flex flex-col gap-4">
      {editor ? (
        <details className="rounded-card border border-line bg-surface p-5 shadow-card">
          <summary className="cursor-pointer text-[14px] font-bold text-purple">Nouvelle mission</summary>
          <ActionForm action={createMission} submitLabel="Créer la mission" resetOnSuccess className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="name" label="Nom de la mission" required maxLength={120} />
              <Field name="managerId" label="Manager responsable" required>
                <option value="">Choisir…</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Field>
              <Field name="country" label="Calendrier des fériés" required defaultValue="MA">
                <option value="MA">Maroc</option>
                <option value="FR">France</option>
              </Field>
              <span />
              <Field name="startDate" label="Début" type="date" required />
              <Field name="endDate" label="Fin" type="date" required />
            </div>
          </ActionForm>
        </details>
      ) : null}

      {missions.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-6 text-[13.5px] text-ink-muted shadow-card">
          Aucune mission dans votre périmètre.
        </p>
      ) : (
        missions.map((m) => (
          <section
            key={m.id}
            aria-labelledby={`mission-${m.id}`}
            className="rounded-card border border-line bg-surface p-5 shadow-card"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`mission-${m.id}`} className="text-[15.5px] font-bold">
                {m.name}
              </h2>
              <p className="text-[12px] text-ink-subtle">
                {m.manager.name} · {m.country === "MA" ? "Maroc" : "France"} · {formatIsoDate(m.startDate)} →{" "}
                {formatIsoDate(m.endDate)} · {m._count.contracts} contrat{m._count.contracts > 1 ? "s" : ""}
              </p>
            </div>
            <ul className="mt-3 flex flex-col gap-2.5">
              {m.purchaseOrders.length === 0 ? <li className="text-[13px] text-ink-muted">Aucun bon de commande.</li> : null}
              {m.purchaseOrders.map((p) => {
                const h = poHealth(p.budgetHalfDays, p.consumedHalfDays);
                return (
                  <li key={p.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                      <span className="font-semibold">
                        {p.number}{" "}
                        <span className="font-normal text-ink-subtle">
                          · {formatIsoDate(p.startDate)} → {formatIsoDate(p.endDate)}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatDays(p.consumedHalfDays)} / {formatDays(p.budgetHalfDays)} j ({Math.round(h.ratio * 100)} %)
                      </span>
                    </div>
                    <ConsumptionBar ratio={h.ratio} level={h.level} height={8} />
                  </li>
                );
              })}
            </ul>
            {editor ? (
              <details className="mt-4 border-t border-line-soft pt-3">
                <summary className="cursor-pointer text-[13px] font-semibold text-purple">Nouveau bon de commande</summary>
                <ActionForm action={createPurchaseOrder} submitLabel="Créer le bon de commande" resetOnSuccess className="mt-3">
                  <input type="hidden" name="missionId" value={m.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field name="number" label="Numéro" required placeholder="PO-2027-0001" maxLength={40} />
                    <Field name="budgetDays" label="Budget (jours)" type="number" required min={0.5} step={0.5} />
                    <Field name="currency" label="Devise" required defaultValue="EUR">
                      <option value="EUR">EUR</option>
                      <option value="MAD">MAD</option>
                    </Field>
                    <Field name="startDate" label="Début" type="date" required min={m.startDate} max={m.endDate} />
                    <Field name="endDate" label="Fin" type="date" required min={m.startDate} max={m.endDate} />
                  </div>
                </ActionForm>
              </details>
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}
