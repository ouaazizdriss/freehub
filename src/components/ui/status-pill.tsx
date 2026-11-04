import type { TimesheetStatus } from "@/generated/prisma/enums";

const STYLES: Record<TimesheetStatus, { label: string; className: string }> = {
  DRAFT: { label: "Brouillon", className: "bg-warning-bg text-warning" },
  SUBMITTED: { label: "Soumis", className: "bg-info-bg text-cyan-ink" },
  VALIDATED: { label: "Validé", className: "bg-success-bg text-success" },
  REJECTED: { label: "À corriger", className: "bg-danger-bg text-danger" },
};

export function StatusPill({ status }: { status: TimesheetStatus }) {
  const s = STYLES[status];
  return <span className={`inline-block rounded-pill px-2.5 py-1 text-xs font-bold ${s.className}`}>{s.label}</span>;
}
