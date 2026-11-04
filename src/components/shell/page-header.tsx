import { ROUTES, type RouteKey } from "@/lib/navigation";

/** En-tête de page : sur-titre, titre, sous-titre, actions à droite. */
export function PageHeader({ route, title, actions }: { route: RouteKey; title?: string; actions?: React.ReactNode }) {
  const { head } = ROUTES[route];
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-2xl flex-col gap-1">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-subtle uppercase">{head.kicker}</p>
        <h1 className="text-[27px] leading-tight font-bold tracking-[-0.03em]">{title ?? head.title}</h1>
        <p className="text-[13.5px] text-ink-muted">{head.sub}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
