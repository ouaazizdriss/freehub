import type { LucideIcon } from "lucide-react";
import { Briefcase, CalendarDays, CalendarOff, ClipboardCheck, LayoutDashboard, Users } from "lucide-react";
import type { Role } from "@/generated/prisma/enums";

/**
 * Routes, rôles autorisés et en-têtes de page — source unique pour la sidebar,
 * les gardes d'accès (requireRole) et les en-têtes.
 * Pas d'import serveur ici : le module est aussi lu par la sidebar (composant exécuté dans le navigateur).
 */
export type RouteKey = "cra" | "absences" | "missions" | "pilotage" | "validation" | "freelances";

export type RouteDef = {
  href: `/${string}`;
  roles: readonly Role[];
  icon: LucideIcon;
  head: { kicker: string; title: string; sub: string };
};

export const ROUTES: Record<RouteKey, RouteDef> = {
  cra: {
    href: "/cra",
    roles: ["FREELANCE", "ADMIN"],
    icon: CalendarDays,
    head: {
      kicker: "Compte rendu d'activité",
      title: "Mon CRA",
      sub: "Saisie en jours ou demi-journées, heures supplémentaires et astreintes imputées sur le bon de commande.",
    },
  },
  absences: {
    href: "/absences",
    roles: ["FREELANCE", "MANAGER", "ADMIN"],
    icon: CalendarOff,
    head: {
      kicker: "Disponibilités",
      title: "Absences & congés",
      sub: "Indisponibilités déclarées par les freelances et impact sur le plan de charge.",
    },
  },
  missions: {
    href: "/missions",
    roles: ["FREELANCE"],
    icon: Briefcase,
    head: { kicker: "Référentiel", title: "Mes missions", sub: "Vos missions, bons de commande et conditions contractuelles." },
  },
  pilotage: {
    href: "/pilotage",
    roles: ["MANAGER", "ADMIN", "FINANCE"],
    icon: LayoutDashboard,
    head: {
      kicker: "Pilotage",
      title: "Portefeuille freelances",
      sub: "Consommation des budgets, avancement de la clôture et alertes contractuelles.",
    },
  },
  validation: {
    href: "/validation",
    roles: ["MANAGER", "ADMIN", "FINANCE"],
    icon: ClipboardCheck,
    head: {
      kicker: "Validation",
      title: "File de validation",
      sub: "Vérifiez les jours déclarés avant transmission à la compta.",
    },
  },
  freelances: {
    href: "/freelances",
    roles: ["MANAGER", "ADMIN"],
    icon: Users,
    head: {
      kicker: "Référentiel",
      title: "Freelances & missions",
      sub: "Contrats, TJM, bons de commande et consommation en cours.",
    },
  },
};

/** Menus par rôle (libellés propres à chaque profil, cf. handoff « Menus par rôle »). */
export const NAV: Record<Role, { route: RouteKey; label: string }[]> = {
  FREELANCE: [
    { route: "cra", label: "Mon CRA" },
    { route: "absences", label: "Absences" },
    { route: "missions", label: "Mes missions" },
  ],
  MANAGER: [
    { route: "pilotage", label: "Pilotage" },
    { route: "validation", label: "Validation" },
    { route: "freelances", label: "Freelances" },
    { route: "absences", label: "Absences" },
  ],
  ADMIN: [
    { route: "pilotage", label: "Pilotage" },
    { route: "freelances", label: "Freelances" },
    { route: "validation", label: "Contrôle CRA" },
    { route: "cra", label: "Détail CRA" },
    { route: "absences", label: "Absences" },
  ],
  // FINANCE : rôle cité dans la stack du handoff sans menu maquetté — accès lecture proposé, à confirmer.
  FINANCE: [
    { route: "pilotage", label: "Pilotage" },
    { route: "validation", label: "Contrôle CRA" },
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  FREELANCE: "Freelance",
  MANAGER: "Manager",
  ADMIN: "Admin / Achats",
  FINANCE: "Finance",
};

export function homeFor(role: Role): string {
  return ROUTES[NAV[role][0].route].href;
}
