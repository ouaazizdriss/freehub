import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConsumptionBar } from "@/components/referential/ui";
import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/skeletons";
import { requireRole } from "@/lib/auth/dal";
import { formatLongDate, isoDate, todayIso } from "@/lib/domain/calendar";
import type { AlertLevel } from "@/lib/domain/alerts";
import { formatDays } from "@/lib/domain/timesheet";
import { ROUTES } from "@/lib/navigation";
import { dashboard } from "@/lib/queries/referential";

export const metadata: Metadata = { title: ROUTES.pilotage.head.title };

export default function PilotagePage() {
  return (
    <>
      <PageHeader route="pilotage" />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

const card = "rounded-card border border-line bg-surface p-5 shadow-card";
const ALERT_STYLE: Record<AlertLevel, string> = {
  danger: "bg-danger-bg text-danger",
  warning: "bg-warning-bg text-warning",
  info: "bg-lavender-light text-cell-half-ink",
};
const ALERT_DOT: Record<AlertLevel, string> = { danger: "bg-danger", warning: "bg-warning", info: "bg-purple" };

async function Content() {
  const user = await requireRole(ROUTES.pilotage.roles);
  const today = todayIso();
  const d = await dashboard(user, today);
  const budgetRatio = d.kpis.budgetHalfDays > 0 ? d.kpis.consumedHalfDays / d.kpis.budgetHalfDays : 0;
  const deposited = d.closing.validated + d.closing.toValidate;
  const depositedPct = d.closing.expected > 0 ? Math.round((deposited / d.closing.expected) * 100) : 100;
  const monthKey = isoDate(d.period.year, d.period.month1, 1).slice(0, 7);
  const canOpenReferential = ROUTES.freelances.roles.includes(user.role);

  const kpis = [
    {
      label: "Freelances actifs",
      value: String(d.kpis.activeFreelancers),
      hint: `${d.kpis.activeMissions} mission${d.kpis.activeMissions > 1 ? "s" : ""} en cours`,
    },
    {
      label: "Jours facturés",
      value: `${formatDays(d.kpis.billedHalfDays)} j`,
      hint: `${d.period.label}, CRA soumis ou validés`,
    },
    {
      label: "Budget consommé",
      value: `${Math.round(budgetRatio * 100)} %`,
      hint: `${formatDays(d.kpis.consumedHalfDays)} / ${formatDays(d.kpis.budgetHalfDays)} j des PO actifs`,
      bar: budgetRatio,
    },
    {
      label: "CRA en retard",
      value: String(d.kpis.late),
      hint:
        today > d.late.deadline
          ? `${d.late.label} : échéance du ${formatLongDate(d.late.deadline)} dépassée`
          : `${d.kpis.missing} CRA ${d.period.label.toLowerCase()} à déposer avant le ${formatLongDate(d.period.deadline)}`,
      danger: d.kpis.late > 0,
    },
  ];

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {kpis.map((k) => (
          <div key={k.label} className={card}>
            <p className="text-[11.5px] font-semibold text-ink-subtle">{k.label}</p>
            <p
              className={`mt-1 text-[29px] leading-tight font-bold tracking-[-0.02em] tabular-nums ${"danger" in k && k.danger ? "text-danger" : ""}`}
            >
              {k.value}
            </p>
            <p className="text-[11.5px] text-ink-subtle">{k.hint}</p>
            {"bar" in k && k.bar !== undefined ? (
              <div className="mt-2">
                <ConsumptionBar ratio={k.bar} level={k.bar > 1 ? "exceeded" : k.bar >= 0.85 ? "tight" : "ok"} height={4} />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[1.55fr_1fr]">
        <section aria-labelledby="conso" className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="conso" className="text-[15.5px] font-bold">
              Consommé vs budget par mission
            </h2>
            <a
              href={`/api/exports/monthly?mois=${monthKey}`}
              className="text-[12.5px] font-semibold text-purple underline-offset-2 hover:underline"
            >
              Export Excel {d.period.label}
            </a>
          </div>
          {d.missions.length === 0 ? <p className="mt-3 text-[13px] text-ink-muted">Aucun bon de commande actif.</p> : null}
          <ul className="mt-4 flex flex-col gap-3.5">
            {d.missions.map((m) => {
              const ratio = m.budgetHalfDays > 0 ? m.consumedHalfDays / m.budgetHalfDays : 0;
              return (
                <li key={m.id} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <span>
                      <span className="font-semibold">{m.mission}</span> <span className="text-ink-subtle">· {m.po}</span>
                    </span>
                    <span className={`tabular-nums ${m.level === "ok" ? "" : "font-semibold text-orange-ink"}`}>
                      {formatDays(m.consumedHalfDays)} / {formatDays(m.budgetHalfDays)} j ({Math.round(ratio * 100)} %)
                    </span>
                  </div>
                  <ConsumptionBar ratio={ratio} level={m.level} height={9} />
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="cloture" className="rounded-card bg-gradient-closing p-5 text-white shadow-card">
            <h2 id="cloture" className="text-[13px] font-semibold opacity-90">
              Clôture {d.period.label}
            </h2>
            <p className="text-[36px] leading-tight font-extrabold tabular-nums">{depositedPct} %</p>
            <p className="text-[12px] opacity-90">des CRA attendus sont déposés</p>
            <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-pill bg-white/30">
              <div className="h-full rounded-pill bg-white" style={{ width: `${depositedPct}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["Validés", d.closing.validated],
                ["À valider", d.closing.toValidate],
                ["Manquants", d.closing.missing],
              ].map(([label, n]) => (
                <div key={label} className="rounded-control bg-white/15 px-2 py-1.5">
                  <dt className="text-[11px] opacity-90">{label}</dt>
                  <dd className="text-[17px] font-bold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
            {user.role !== "FINANCE" || d.closing.toValidate > 0 ? (
              <Link
                href="/validation"
                className="mt-3 flex min-h-11 items-center justify-center rounded-control bg-white text-[12.5px] font-semibold text-purple"
              >
                Ouvrir la file de validation
              </Link>
            ) : null}
          </section>

          <section aria-labelledby="alertes" className={card}>
            <h2 id="alertes" className="text-[15.5px] font-bold">
              Alertes
            </h2>
            {d.alerts.length === 0 ? <p className="mt-2 text-[13px] text-ink-muted">Rien à signaler.</p> : null}
            <ul className="mt-3 flex flex-col gap-2">
              {d.alerts.map((a, i) => (
                <li key={i} className={`flex gap-2.5 rounded-control px-3 py-2.5 ${ALERT_STYLE[a.level]}`}>
                  <span aria-hidden className={`mt-1.5 size-2 flex-none rounded-full ${ALERT_DOT[a.level]}`} />
                  <div>
                    <p className="text-[12.5px] font-semibold">
                      {a.href && canOpenReferential ? (
                        <Link href={a.href} className="underline-offset-2 hover:underline">
                          {a.title}
                        </Link>
                      ) : (
                        a.title
                      )}
                    </p>
                    <p className="text-[11.5px]">{a.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
