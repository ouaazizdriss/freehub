import type { Metadata } from "next";
import { Suspense } from "react";
import { UploadDocumentForm } from "@/components/referential/forms";
import { ConsumptionBar, DocumentStatePill, formatIsoDate } from "@/components/referential/ui";
import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/skeletons";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { DOCUMENT_LABELS, documentStates, poHealth, REQUIRED_DOCUMENTS, type DocumentKind } from "@/lib/domain/alerts";
import { todayIso } from "@/lib/domain/calendar";
import { formatDays, formatEur } from "@/lib/domain/timesheet";
import { ROUTES } from "@/lib/navigation";
import { CONSUMING_STATUSES, toIso } from "@/lib/queries/cra-editor";

export const metadata: Metadata = { title: ROUTES.missions.head.title };

export default function MissionsPage() {
  return (
    <>
      <PageHeader route="missions" />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}

const card = "rounded-card border border-line bg-surface p-5 shadow-card";

async function Content() {
  const user = await requireRole(ROUTES.missions.roles);
  const today = todayIso();
  const freelancer = await db.freelancer.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      documents: {
        orderBy: { uploadedAt: "desc" },
        select: { id: true, kind: true, expiresAt: true, fileName: true, fileKey: true },
      },
      contracts: {
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          dailyRateCents: true,
          overtimeHourlyRateCents: true,
          onCallRateCents: true,
          currency: true,
          mission: {
            select: {
              name: true,
              manager: { select: { name: true } },
              purchaseOrders: {
                orderBy: { endDate: "desc" },
                select: { id: true, number: true, budgetHalfDays: true, endDate: true },
              },
            },
          },
        },
      },
    },
  });
  if (!freelancer)
    return (
      <p className={`mt-6 ${card} text-[13.5px] text-ink-muted`}>Aucune fiche freelance n&apos;est rattachée à votre compte.</p>
    );

  // Consommation des PO : part de ce freelance et total (pour situer le budget restant).
  const poIds = freelancer.contracts.flatMap((c) => c.mission.purchaseOrders.map((p) => p.id));
  const usage = await db.timesheet.groupBy({
    by: ["purchaseOrderId"],
    where: { purchaseOrderId: { in: poIds }, status: { in: CONSUMING_STATUSES } },
    _sum: { totalWorkHalfDays: true },
  });
  const used = new Map(usage.map((u) => [u.purchaseOrderId, u._sum.totalWorkHalfDays ?? 0]));
  const states = documentStates(
    freelancer.documents.map((d) => ({ kind: d.kind as DocumentKind, expiresAt: d.expiresAt ? toIso(d.expiresAt) : null })),
    today,
  );

  return (
    <div className="mt-5 grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="mes-contrats" className="flex flex-col gap-3">
        <h2 id="mes-contrats" className="sr-only">
          Mes contrats
        </h2>
        {freelancer.contracts.length === 0 ? <p className={`${card} text-[13.5px] text-ink-muted`}>Aucun contrat.</p> : null}
        {freelancer.contracts.map((c) => {
          const start = toIso(c.startDate);
          const end = toIso(c.endDate);
          const current = start <= today && end >= today;
          return (
            <article key={c.id} className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15.5px] font-bold">
                  {c.mission.name}
                  {current ? (
                    <span className="ml-2 rounded-pill bg-success-bg px-2 py-0.5 text-[11px] font-bold text-success">
                      En cours
                    </span>
                  ) : null}
                </h3>
                <span className="text-[12.5px] text-ink-subtle">
                  {formatIsoDate(start)} → {formatIsoDate(end)} · manager {c.mission.manager.name}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ["TJM", formatEur(c.dailyRateCents, c.currency)],
                  ["Heure sup.", formatEur(c.overtimeHourlyRateCents, c.currency)],
                  ["Astreinte", formatEur(c.onCallRateCents, c.currency)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-cell bg-surface-soft px-3 py-2">
                    <dt className="text-[10.5px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">{label}</dt>
                    <dd className="text-[15px] font-bold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-3 flex flex-col gap-2">
                {c.mission.purchaseOrders.map((p) => {
                  const h = poHealth(p.budgetHalfDays, used.get(p.id) ?? 0);
                  return (
                    <li key={p.id} className="flex flex-col gap-1 text-[12.5px]">
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold">Bon de commande {p.number}</span>
                        <span className="tabular-nums">
                          {formatDays(used.get(p.id) ?? 0)} / {formatDays(p.budgetHalfDays)} j consommés
                        </span>
                      </div>
                      <ConsumptionBar ratio={h.ratio} level={h.level} />
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </section>

      <aside className={card} aria-labelledby="mes-pieces">
        <h2 id="mes-pieces" className="text-[15.5px] font-bold">
          Mes pièces justificatives
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">Pièces exigées pour être payé : tenez-les à jour.</p>
        <ul className="mt-3 flex flex-col gap-2">
          {REQUIRED_DOCUMENTS.map((kind) => (
            <li key={kind} className="flex items-center justify-between gap-2 text-[13px]">
              {DOCUMENT_LABELS[kind]}
              <DocumentStatePill state={states[kind]} />
            </li>
          ))}
        </ul>
        {freelancer.documents.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[12.5px]">
            {freelancer.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2">
                {d.fileKey ? (
                  <a
                    href={`/api/documents/${encodeURIComponent(d.id)}`}
                    className="font-semibold text-purple underline-offset-2 hover:underline"
                  >
                    {DOCUMENT_LABELS[d.kind as DocumentKind]}
                    <span className="sr-only"> — {d.fileName}</span>
                  </a>
                ) : (
                  <span className="font-semibold">{DOCUMENT_LABELS[d.kind as DocumentKind]}</span>
                )}
                <span className="text-ink-subtle">expire le {formatIsoDate(d.expiresAt ? toIso(d.expiresAt) : null)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 border-t border-line-soft pt-3">
          <h3 className="mb-2 text-[13px] font-bold">Déposer une pièce</h3>
          <UploadDocumentForm />
        </div>
        <p className="mt-4 border-t border-line-soft pt-3 text-[12px] text-ink-muted">
          Vos données personnelles :{" "}
          <a href="/api/rgpd/export" className="font-semibold text-purple underline-offset-2 hover:underline">
            télécharger l&apos;export (JSON)
          </a>
          .
        </p>
      </aside>
    </div>
  );
}
