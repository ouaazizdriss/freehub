import { Construction } from "lucide-react";

/** Contenu provisoire d'un écran dont l'implémentation est prévue dans un lot ultérieur. */
export function LotPlaceholder({ lot, items }: { lot: string; items: string[] }) {
  return (
    <section className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card">
      <div className="flex items-center gap-2 text-purple">
        <Construction aria-hidden size={18} />
        <h2 className="text-[15.5px] font-bold">Prévu au {lot}</h2>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </section>
  );
}
