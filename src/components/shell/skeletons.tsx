const bar = "animate-pulse rounded-control bg-surface-sunken motion-reduce:animate-none";

export function NavSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={`${bar} h-10`} />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Chargement" className="flex flex-col gap-3">
      <div className={`${bar} h-3 w-32`} />
      <div className={`${bar} h-8 w-72`} />
      <div className={`${bar} h-4 w-[28rem] max-w-full`} />
      <div className={`${bar} mt-4 h-64`} />
    </div>
  );
}

export function SectionSkeleton() {
  return (
    <div
      role="status"
      aria-label="Chargement"
      className="mt-6 flex flex-col gap-3 rounded-card border border-line bg-surface p-6"
    >
      <div className={`${bar} h-4 w-40`} />
      <div className={`${bar} h-24`} />
    </div>
  );
}
