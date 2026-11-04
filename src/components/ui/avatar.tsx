export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** Avatar à initiales (décoratif : le nom est toujours écrit à côté). */
export function Avatar({ name, size = 30, active = false, gradient = false }: { name: string; size?: number; active?: boolean; gradient?: boolean }) {
  const tone = gradient ? "bg-gradient-primary text-white" : active ? "bg-purple text-white" : "bg-lavender text-purple";
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={`flex flex-none items-center justify-center rounded-full font-bold ${tone}`}
    >
      {initials(name)}
    </span>
  );
}
