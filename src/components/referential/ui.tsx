import { FREELANCER_STATUS_LABELS, type DocumentState, type FreelancerStatus, type PoLevel } from "@/lib/domain/alerts";

const STATUS_STYLE: Record<FreelancerStatus, string> = {
  ACTIVE: "bg-success-bg text-success",
  PO_TIGHT: "bg-warning-bg text-warning",
  ENDING: "bg-danger-bg text-danger",
  DOCS_KO: "bg-lavender-light text-purple",
  INACTIVE: "bg-surface-sunken text-ink-subtle",
};

export function FreelancerStatusPill({ status }: { status: FreelancerStatus }) {
  return (
    <span className={`inline-block rounded-pill px-2.5 py-1 text-xs font-bold whitespace-nowrap ${STATUS_STYLE[status]}`}>
      {FREELANCER_STATUS_LABELS[status]}
    </span>
  );
}

const BAR: Record<PoLevel, string> = { ok: "bg-purple", tight: "bg-orange", exceeded: "bg-danger-bright" };

/** Barre de consommation (décorative : la valeur est toujours écrite à côté). */
export function ConsumptionBar({ ratio, level, height = 6 }: { ratio: number; level: PoLevel; height?: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return (
    <div aria-hidden className="w-full overflow-hidden rounded-pill bg-surface-sunken" style={{ height }}>
      <div className={`h-full rounded-pill ${BAR[level]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const DOC_STYLE: Record<DocumentState, [string, string]> = {
  ok: ["bg-success-bg text-success", "Valide"],
  expiring: ["bg-warning-bg text-warning", "Expire bientôt"],
  expired: ["bg-danger-bg text-danger", "Expirée"],
  missing: ["bg-danger-bg text-danger", "Manquante"],
};

export function DocumentStatePill({ state }: { state: DocumentState }) {
  const [cls, label] = DOC_STYLE[state];
  return <span className={`inline-block rounded-pill px-2 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>;
}

export const formatIsoDate = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${iso}T00:00:00Z`),
      )
    : "—";
