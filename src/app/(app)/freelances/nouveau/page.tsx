import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NewFreelancerForm } from "@/components/referential/forms";
import { SectionSkeleton } from "@/components/shell/skeletons";
import { requireRole } from "@/lib/auth/dal";
import { REFERENTIAL_EDITORS } from "@/lib/queries/referential";

export const metadata: Metadata = { title: "Nouveau freelance" };

export default function NewFreelancerPage() {
  return (
    <>
      <Link href="/freelances" className="text-[12.5px] font-semibold text-purple underline-offset-2 hover:underline">
        ‹ Freelances
      </Link>
      <h1 className="mt-2 text-[27px] leading-tight font-bold tracking-[-0.03em]">Nouveau freelance</h1>
      <p className="text-[13.5px] text-ink-muted">Le compte se connecte par SSO avec cet e-mail. Ajoutez ensuite son contrat depuis sa fiche.</p>
      <Suspense fallback={<SectionSkeleton />}>
        <Gate />
      </Suspense>
    </>
  );
}

async function Gate() {
  await requireRole(REFERENTIAL_EDITORS);
  return (
    <section className="mt-5 max-w-3xl rounded-card border border-line bg-surface p-5 shadow-card">
      <NewFreelancerForm />
    </section>
  );
}
