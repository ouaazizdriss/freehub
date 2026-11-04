import Link from "next/link";
import { Suspense } from "react";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { connection } from "next/server";
import { formatDateTime, formatMonth } from "@/lib/domain/calendar";
import { formatDays, formatEur } from "@/lib/domain/timesheet";
import { AUTH_CODE_PATTERN } from "@/lib/documents/auth-code";
import { verifyAuthCode } from "@/lib/documents/content";
import { clientIp, limited } from "@/lib/rate-limit";

export default function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<p className="text-[13.5px] text-ink-muted">Vérification…</p>}>
      <Result params={params} />
    </Suspense>
  );
}

async function Result({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  if (await limited("verify", await clientIp())) {
    return (
      <section role="status" className="rounded-card border border-line bg-surface p-6 text-[13.5px] text-ink-3 shadow-card">
        Trop de vérifications depuis votre adresse : réessayez dans une minute.
      </section>
    );
  }
  const raw = (await params).code;
  let code: string;
  try {
    code = decodeURIComponent(raw).trim().toUpperCase();
  } catch {
    code = raw.toUpperCase();
  }
  const result = AUTH_CODE_PATTERN.test(code) ? await verifyAuthCode(code) : null;
  const back = (
    <Link href="/verify" className="text-[13px] font-semibold text-purple underline">
      Vérifier une autre référence
    </Link>
  );

  if (!result) {
    return (
      <section role="status" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="flex items-center gap-2 text-[20px] font-bold text-danger">
          <CircleX aria-hidden className="size-6" /> Référence inconnue
        </h1>
        <p className="text-[13.5px] text-ink-3">
          Aucun CRA soumis ou validé ne correspond à <span className="font-mono">{code.slice(0, 40)}</span>. Le document a pu être
          renvoyé en correction, ou la référence est mal saisie.
        </p>
        {back}
      </section>
    );
  }

  const { doc, intact, kind } = result;
  const validated = doc.status === "VALIDATED";
  return (
    <section role="status" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-card">
      {kind === "superseded" ? (
        <h1 className="flex items-center gap-2 text-[20px] font-bold text-warning">
          <TriangleAlert aria-hidden className="size-6" /> Version provisoire, remplacée par une version validée
        </h1>
      ) : !intact ? (
        <h1 className="flex items-center gap-2 text-[20px] font-bold text-danger">
          <TriangleAlert aria-hidden className="size-6" /> Document non conforme
        </h1>
      ) : (
        <h1 className={`flex items-center gap-2 text-[20px] font-bold ${validated ? "text-success" : "text-warning"}`}>
          <CircleCheck aria-hidden className="size-6" />
          {validated ? "Document authentique — CRA validé" : "Document authentique — en attente de validation"}
        </h1>
      )}
      {kind === "superseded" ? (
        <p className="text-[13.5px] text-ink-3">
          Ce PDF provisoire est authentique, mais le CRA a depuis été validé : demandez le PDF validé, seul à faire foi.
        </p>
      ) : null}
      {!intact ? (
        <p className="text-[13.5px] text-ink-3">
          Les données enregistrées ne correspondent plus à ce code : ce PDF ne fait pas foi. Contactez l&apos;émetteur.
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        <dt className="text-ink-muted">Référence</dt>
        <dd className="font-mono">{code}</dd>
        <dt className="text-ink-muted">Freelance</dt>
        <dd className="font-semibold">{doc.freelancerName}</dd>
        <dt className="text-ink-muted">Mission</dt>
        <dd>
          {doc.missionName} · {doc.poNumber}
        </dd>
        <dt className="text-ink-muted">Mois</dt>
        <dd className="capitalize">{formatMonth(doc.year, doc.month1)}</dd>
        <dt className="text-ink-muted">Jours</dt>
        <dd>{formatDays(doc.totals.workHalfDays)} j</dd>
        <dt className="text-ink-muted">Montant HT</dt>
        <dd className="font-semibold">{formatEur(doc.totals.amountCents, doc.currency)}</dd>
        <dt className="text-ink-muted">Statut</dt>
        <dd>
          {validated
            ? `Validé le ${doc.validatedAt ? formatDateTime(doc.validatedAt) : "—"}`
            : "Soumis, en attente de validation"}
        </dd>
      </dl>
      {back}
    </section>
  );
}
