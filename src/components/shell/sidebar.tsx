import { signOut } from "@/auth";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/dal";
import { closingPeriod, formatLongDate, formatMonth, todayIso } from "@/lib/domain/calendar";
import { ROLE_LABELS } from "@/lib/navigation";
import { pendingValidationCount } from "@/lib/queries/timesheets";
import { Avatar } from "@/components/ui/avatar";
import { LogoutForm } from "./logout-form";
import { SidebarNav } from "./sidebar-nav";

/** Partie de la sidebar qui dépend de la session (streamée derrière <Suspense>). */
export async function SidebarContent() {
  const user = await requireUser();
  const pending = await pendingValidationCount(user);
  const closing = closingPeriod(todayIso());

  async function logout() {
    "use server";
    // Révoque toutes les sessions de l'utilisateur (le jeton JWT seul ne peut pas l'être).
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    await signOut({ redirectTo: "/login" });
  }

  return (
    <>
      <SidebarNav role={user.role} badges={{ validation: pending }} />

      <div className="mt-auto flex flex-col gap-3">
        <section aria-label="Clôture CRA" className="rounded-card-sm bg-lavender-light p-3.5">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-purple uppercase">Clôture CRA</p>
          <p className="mt-1 text-[13px] font-semibold text-purple-deep">{formatMonth(closing.year, closing.month1)}</p>
          <p className="text-xs text-ink-3">À déposer avant le {formatLongDate(closing.deadline)}</p>
        </section>

        <div className="flex items-center gap-2.5 px-1.5">
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{user.name}</p>
            <p className="truncate text-xs text-ink-subtle">{ROLE_LABELS[user.role]}</p>
          </div>
          <LogoutForm action={logout} />
        </div>
      </div>
    </>
  );
}
