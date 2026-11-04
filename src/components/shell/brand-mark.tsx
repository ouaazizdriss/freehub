/**
 * Marque de l'application.
 * TODO(lot-0) : remplacer le carré dégradé par le logo définitif.
 */
export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <div aria-hidden className="size-[30px] rounded-[9px] bg-gradient-brand" />
      <span className="text-sm font-bold tracking-[-0.02em]">Freelance Hub</span>
    </div>
  );
}
