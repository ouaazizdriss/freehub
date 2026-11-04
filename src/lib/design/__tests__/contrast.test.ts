import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Garde-fou : chaque couple texte/fond utilisé par l'UI doit rester ≥ 4,5:1 (WCAG AA, texte normal). */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [fg: string, bg: string][] = [
  ["ink", "page"],
  ["ink-2", "surface"],
  ["ink-3", "surface"],
  ["ink-muted", "surface"],
  ["ink-subtle", "surface"],
  ["ink-subtle", "surface-soft"],
  ["ink-subtle", "page"],
  ["purple", "surface"],
  ["purple", "lavender-light"],
  ["purple-deep", "lavender-light"],
  ["surface", "purple"],
  ["surface", "pink-ink"],
  ["orange-ink", "surface"],
  ["orange-ink", "cell-work"],
  ["success", "success-bg"],
  ["warning", "warning-bg"],
  ["danger", "danger-bg"],
  ["cyan-ink", "info-bg"],
  ["cell-work-ink", "cell-work"],
  ["cell-half-ink", "cell-half"],
  ["cell-absence-ink", "cell-absence"],
  ["cell-holiday-ink", "cell-holiday"],
  ["cell-weekend-ink", "cell-weekend"],
  ["cell-empty-ink", "cell-empty"],
];

describe("contraste des tokens (WCAG AA)", () => {
  it.each(PAIRS)("%s sur %s ≥ 4,5:1", (fg, bg) => {
    expect(tokens[fg], `token --color-${fg}`).toBeDefined();
    expect(tokens[bg], `token --color-${bg}`).toBeDefined();
    expect(ratio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
