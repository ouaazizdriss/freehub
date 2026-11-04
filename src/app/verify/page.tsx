import { redirect } from "next/navigation";

async function lookup(formData: FormData) {
  "use server";
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase();
  redirect(`/verify/${encodeURIComponent(code)}`);
}

export default function VerifyPage() {
  return (
    <section className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">Vérifier l&apos;authenticité d&apos;un CRA</h1>
      <p className="mt-1 text-[13.5px] text-ink-muted">
        Saisissez la référence imprimée sous le code-barres du PDF (format CRA-MMAA-PO-CLÉ).
      </p>
      <form action={lookup} className="mt-5 flex flex-col gap-2">
        <label htmlFor="code" className="text-[11.5px] font-semibold text-ink-muted">
          Référence du document
        </label>
        <input
          id="code"
          name="code"
          required
          autoComplete="off"
          spellCheck={false}
          minLength={20}
          maxLength={40}
          placeholder="CRA-1026-0417-XXXXXXXXXX"
          className="min-h-11 rounded-control border border-line-strong px-3 font-mono text-[14px] uppercase"
        />
        <button
          type="submit"
          className="mt-2 min-h-11 rounded-control bg-gradient-primary text-[13px] font-semibold text-white shadow-cta"
        >
          Vérifier
        </button>
      </form>
    </section>
  );
}
