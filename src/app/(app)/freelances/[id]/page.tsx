import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActivationForm, EditContractForm, EditFreelancerForm, NewContractForm, UploadDocumentForm } from "@/components/referential/forms";
import { DocumentStatePill, formatIsoDate } from "@/components/referential/ui";
import { PageSkeleton } from "@/components/shell/skeletons";
import { Avatar } from "@/components/ui/avatar";
import { requireRole } from "@/lib/auth/dal";
import { DOCUMENT_LABELS, documentStates, REQUIRED_DOCUMENTS, type DocumentKind } from "@/lib/domain/alerts";
import { todayIso } from "@/lib/domain/calendar";
import { formatEur } from "@/lib/domain/timesheet";
import { ROUTES } from "@/lib/navigation";
import { getFreelancer, listMissionOptions } from "@/lib/queries/referential";
import { toIso } from "@/lib/queries/cra-editor";

export const metadata: Metadata = { title: "Fiche freelance" };

export default function FreelancerPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <Link href="/freelances" className="text-[12.5px] font-semibold text-purple underline-offset-2 hover:underline">
        ‹ Freelances
      </Link>
      <Suspense fallback={<PageSkeleton />}>
        <Content params={params} />
      </Suspense>
    </>
  );
}

const card = "rounded-card border border-line bg-surface p-5 shadow-card";

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ROUTES.freelances.roles);
  const { id } = await params;
  const f = await getFreelancer(user, id);
  if (!f) notFound();
  const editor = user.role === "ADMIN";
  const today = todayIso();
  const states = documentStates(
    f.documents.map((d) => ({ kind: d.kind as DocumentKind, expiresAt: d.expiresAt })),
    today,
  );
  const missions = editor ? await listMissionOptions() : [];

  return (
    <div className="mt-3 flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Avatar name={f.user.name} size={44} gradient />
        <div>
          <h1 className="text-[27px] leading-tight font-bold tracking-[-0.03em]">{f.user.name}</h1>
          <p className="text-[13.5px] text-ink-muted">
            {f.jobTitle} · {f.user.email}
            {!f.user.active ? <span className="ml-2 rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-bold text-ink-subtle">Compte désactivé</span> : null}
          </p>
        </div>
      </header>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <section aria-labelledby="contrats" className={card}>
            <h2 id="contrats" className="text-[15.5px] font-bold">
              Contrats
            </h2>
            {f.contracts.length === 0 ? <p className="mt-2 text-[13px] text-ink-muted">Aucun contrat.</p> : null}
            <ul className="mt-3 flex flex-col gap-3">
              {f.contracts.map((c) => {
                const current = c.startDate <= today && c.endDate >= today;
                return (
                  <li key={c.id} className="rounded-control border border-line-soft p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                      <span className="font-semibold">
                        {c.mission.name}
                        {current ? <span className="ml-2 rounded-pill bg-success-bg px-2 py-0.5 text-[11px] font-bold text-success">En cours</span> : null}
                      </span>
                      <span className="text-ink-subtle">
                        {formatIsoDate(c.startDate)} → {formatIsoDate(c.endDate)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-ink-3 tabular-nums">
                      TJM {formatEur(c.dailyRateCents, c.currency)} · heure sup. {formatEur(c.overtimeHourlyRateCents, c.currency)} · astreinte{" "}
                      {formatEur(c.onCallRateCents, c.currency)} · {c._count.timesheets} CRA
                    </p>
                    {editor ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[12.5px] font-semibold text-purple">Modifier</summary>
                        <div className="mt-2">
                          <EditContractForm
                            contract={{
                              id: c.id,
                              endDate: c.endDate,
                              dailyRateCents: c.dailyRateCents,
                              overtimeHourlyRateCents: c.overtimeHourlyRateCents,
                              onCallRateCents: c.onCallRateCents,
                              locked: c.submittedCount > 0,
                            }}
                          />
                        </div>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {editor ? (
              <details className="mt-4 border-t border-line-soft pt-3">
                <summary className="cursor-pointer text-[13px] font-semibold text-purple">Nouveau contrat</summary>
                <div className="mt-3">
                  <NewContractForm
                    freelancerId={f.id}
                    missions={missions.map((m) => ({ id: m.id, name: m.name, start: formatIsoDate(toIso(m.startDate)), end: formatIsoDate(toIso(m.endDate)) }))}
                  />
                </div>
              </details>
            ) : null}
          </section>

          {editor ? (
            <section aria-labelledby="fiche" className={card}>
              <h2 id="fiche" className="mb-3 text-[15.5px] font-bold">
                Fiche
              </h2>
              <EditFreelancerForm
                profile={{ id: f.id, name: f.user.name, email: f.user.email, jobTitle: f.jobTitle, company: f.company, siret: f.siret }}
              />
            </section>
          ) : (
            <section aria-labelledby="fiche" className={card}>
              <h2 id="fiche" className="text-[15.5px] font-bold">
                Fiche
              </h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                <dt className="text-ink-muted">Société</dt>
                <dd>{f.company ?? "—"}</dd>
                <dt className="text-ink-muted">SIRET</dt>
                <dd>{f.siret ?? "—"}</dd>
              </dl>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section aria-labelledby="pieces" className={card}>
            <h2 id="pieces" className="text-[15.5px] font-bold">
              Pièces justificatives
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {REQUIRED_DOCUMENTS.map((kind) => (
                <li key={kind} className="flex items-center justify-between gap-2 text-[13px]">
                  {DOCUMENT_LABELS[kind]}
                  <DocumentStatePill state={states[kind]} />
                </li>
              ))}
            </ul>
            {f.documents.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[12.5px]">
                {f.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    {d.hasFile ? (
                      <a href={`/api/documents/${encodeURIComponent(d.id)}`} className="font-semibold text-purple underline-offset-2 hover:underline">
                        {DOCUMENT_LABELS[d.kind as DocumentKind]}
                        <span className="sr-only"> — {d.fileName}</span>
                      </a>
                    ) : (
                      <span className="font-semibold">{DOCUMENT_LABELS[d.kind as DocumentKind]}</span>
                    )}
                    <span className="text-ink-subtle">expire le {formatIsoDate(d.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {editor ? (
              <details className="mt-4 border-t border-line-soft pt-3">
                <summary className="cursor-pointer text-[13px] font-semibold text-purple">Déposer une pièce</summary>
                <div className="mt-3">
                  <UploadDocumentForm freelancerId={f.id} />
                </div>
              </details>
            ) : null}
          </section>
          {editor ? (
            <section aria-labelledby="compte" className={card}>
              <h2 id="compte" className="mb-2 text-[15.5px] font-bold">
                Compte
              </h2>
              <ActivationForm id={f.id} active={f.user.active} />
              <a
                href={`/api/rgpd/export?freelance=${encodeURIComponent(f.id)}`}
                className="mt-3 inline-block text-[12.5px] font-semibold text-purple underline-offset-2 hover:underline"
              >
                Exporter ses données personnelles (RGPD)
              </a>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
