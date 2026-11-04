/** Lien vers l'écran de saisie d'un mois (et d'un bon de commande si le freelance en a plusieurs). */
export const craHref = (month: string, poId?: string) => `/cra?mois=${month}${poId ? `&po=${encodeURIComponent(poId)}` : ""}`;

/** Lien vers la file de validation, filtrée par statut, avec un CRA sélectionné. */
export const validationHref = (filter: string, id?: string) =>
  `/validation?statut=${filter}${id ? `&cra=${encodeURIComponent(id)}` : ""}`;
