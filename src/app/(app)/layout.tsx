import { Suspense } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SidebarContent } from "@/components/shell/sidebar";
import { NavSkeleton } from "@/components/shell/skeletons";

/**
 * Shell applicatif (Cache Components) : le cadre est statique et prérendu ;
 * tout ce qui dépend de la session est streamé derrière <Suspense>.
 * Chaque page refait son contrôle de rôle (requireRole) : un layout n'est pas
 * ré-exécuté à chaque navigation et ne protège pas les segments enfants.
 * Mobile (< md) : barre supérieure + tiroir de navigation ; desktop : sidebar fixe.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <MobileNav brand={<BrandMark />}>
        <Suspense fallback={<NavSkeleton />}>
          <SidebarContent />
        </Suspense>
      </MobileNav>
      <aside
        data-noprint
        className="sticky top-0 hidden h-screen w-[248px] flex-none flex-col gap-[22px] border-r border-line bg-surface px-3.5 py-5 md:flex"
      >
        <BrandMark />
        <Suspense fallback={<NavSkeleton />}>
          <SidebarContent />
        </Suspense>
      </aside>
      <main id="contenu" className="min-w-0 flex-1 px-3 py-4 pb-28 sm:px-4 md:px-[34px] md:py-[26px] md:pb-[26px]">
        {children}
      </main>
    </div>
  );
}
