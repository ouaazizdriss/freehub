# Freelance Hub

Application interne de gestion des freelances et du CRA mensuel.
Spécification : `../design_handoff_freelance_cra/README.md` (maquette hifi + règles métier).

## Démarrage local

```bash
cp .env.example .env          # puis renseigner AUTH_SECRET (openssl rand -base64 33)
npm install                   # génère aussi le code Prisma
npm run db:up                 # Postgres 16 dans Docker, port 5433
npm run db:migrate            # applique les migrations
npm run db:seed               # données de démo (maquette) — jamais en production
npm run dev                   # http://localhost:3000
```

Sans SSO configuré, `/login` propose les comptes de démo : mettre `AUTH_DEV_LOGIN="true"` dans `.env`
(désactivé par défaut ; toujours inactif en production, si le SSO est configuré ou si `APP_URL` n'est pas locale).

| Script | Rôle |
|---|---|
| `npm test` | Tests unitaires (règles métier, calendrier, alertes, code d'authenticité, contraste des tokens) |
| `npm run test:e2e` | Parcours complet, contrôle d'accès et audit d'accessibilité (Playwright + axe) — voir plus bas |
| `npm run typecheck` / `npm run lint` | Vérifications statiques |
| `npm run db:reset` | Recrée la base et relance le seed |
| `npm run retention` | Purge RGPD (simulation ; `-- --apply` pour exécuter) — voir `docs/RGPD.md` |

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS 4 · Prisma 7 + PostgreSQL ·
Auth.js v5 (Microsoft Entra ID) · pdfkit + bwip-js (PDF, Code 128) · ExcelJS · sharp · nodemailer ·
Vitest · Playwright + axe-core · Lucide.

## Architecture

```
src/
  app/(app)/…            écrans authentifiés (un dossier par route)
  app/login, forbidden   pages publiques
  auth.ts                Auth.js : Entra ID + connexion de démo (dev uniquement)
  proxy.ts               redirection optimiste vers /login sans cookie de session
  lib/auth/dal.ts        Data Access Layer : getCurrentUser / requireRole (rôle relu en base)
  lib/domain/            règles métier pures, partagées navigateur/serveur (calendrier, calcul du CRA)
  lib/navigation.ts      routes, rôles autorisés, menus par profil
  lib/queries/           requêtes Prisma (server-only)
  components/shell/      sidebar, en-tête, squelettes, garde de rôle
  components/cra/        saisie du CRA : grille, panneau du jour, autosave (hors ligne), récapitulatif
  components/validation/ file de validation et panneau de décision
  lib/documents/         PDF, Excel, code d'authenticité (HMAC), scellement, accès aux documents
  lib/storage.ts         stockage privé des fichiers (local, interface prête pour S3 / Azure Blob)
  lib/notify.ts          e-mails (SMTP ou journalisation)
  app/api/               documents (PDF, Excel, pièces), export mensuel, relances (cron), export RGPD
  app/verify/            vérification publique d'un code d'authenticité
prisma/                  schéma, migrations (contraintes CHECK, triggers de verrouillage), seed
scripts/retention.ts     purge de rétention RGPD
e2e/                     tests Playwright
docs/                    RGPD, recette, rapport de sécurité
```

### Conventions

- **Autorisation** : chaque page, Server Action et Route Handler appelle `requireRole()`.
  Le layout n'est pas une barrière de sécurité ; `proxy.ts` n'est qu'un contrôle optimiste.
- **Unités** : argent en centimes (`Int`), jours en demi-journées (`Int`), dates calendaires en `@db.Date`
  manipulées comme chaînes ISO `YYYY-MM-DD` (pas de décalage de fuseau).
- **Calcul** : `lib/domain/timesheet.ts` est la seule implémentation de la valorisation ;
  le serveur reste la source de vérité des totaux persistés.
- **Taux** figés sur le `Timesheet` à la soumission : une évolution du contrat ne modifie pas un CRA soumis.
- **Tokens de design** dans `src/app/globals.css` (`@theme`) : utiliser les classes sémantiques
  (`bg-cell-work`, `text-ink-subtle`…), jamais d'hex en dur. Les couples texte/fond sont testés ≥ 4,5:1.
- **Cache Components** : en-têtes statiques, contenu dépendant de la session sous `<Suspense>`
  (cf. `components/shell/guarded.tsx`).

## Écarts assumés vs maquette

| Maquette | Implémentation | Raison |
|---|---|---|
| Texte tertiaire `#9A93A8` / `#8C8399` | `#6E6680` | Contraste AA (2,9:1 → 5,4:1) |
| Texte orange `#FF5A00`, badge rose texte blanc | `#A33B00`, fond `#D6247C` | Contraste AA |
| Férié 14 juillet | Calendrier du pays de la mission (MA par défaut) | Missions au Maroc |
| HS / astreinte facturées sur un jour d'absence | Non valorisées | Bug du prototype |
| Icônes Unicode, logo placeholder | Lucide ; logo à fournir | Cf. handoff « Assets » |
| Libellé de cellule « Congé » | « Absence » | Une absence peut être un congé, un arrêt ou une indisponibilité |
| Boutons de 40 px environ | 44 px minimum | Cibles tactiles (cf. handoff « Vue mobile ») |
| Correction demandée → retour en `draft` | Reste `REJECTED`, modifiable, motif affiché | Garde la trace de la demande ; à confirmer |
| Bascule Desktop / Mobile (démo) | Responsive : vue mobile distincte sous 768 px | Le prototype simulait un téléphone |
| PDF via `window.print()` | PDF généré côté serveur (pdfkit), une page A4 | Cf. handoff « Génération des documents » |
| Code-barres décoratif, clé mod 97 | Code 128 réel, clé HMAC-SHA256 | Cf. handoff « Règles métier » |
| Astreintes en carte ambre (validation) | Point d'information (lavande) | Contractuelles et fréquentes : n'empêchent pas « Tout valider » |

## Lot 1 — Saisie du CRA

Écran `/cra` (freelance) : grille du mois, panneau de la journée, « appliquer à la semaine »,
totaux et montant estimé en direct, autosave du brouillon, récapitulatif puis soumission.

- **Règles** dans `lib/domain/cra-editor.ts` (pures, testées), rejouées par le serveur avant chaque écriture.
  Bloquant à la soumission : incohérences de journée, travail un week-end ou un férié sans motif, saisie hors contrat,
  dépassement du reste à consommer du PO, CRA vide, mois non commencé, taux différents dans le mois.
  Simples avertissements : jours ouvrés non saisis, mois en cours.
- **Autosave** (`components/cra/use-autosave.ts`) : état complet envoyé 700 ms après la dernière modification,
  une requête à la fois, verrou optimiste par `version`. Pas de relance automatique en cas d'échec (bouton « Réessayer ») ;
  conflit avec un autre onglet → rechargement demandé ; modifications en attente envoyées en quittant l'écran.
- **Soumission** (`app/(app)/cra/actions.ts`) : verrou sur le PO (`SELECT … FOR UPDATE`) pour que le contrôle
  du reste à consommer reste juste en cas de soumissions simultanées, taux du contrat figés, journal d'audit.
- **Un CRA par bon de commande** : plusieurs contrats sur la même mission dans le mois (renouvellement, avenant)
  alimentent le même CRA ; la période saisissable est l'union des contrats, bornée aux dates du PO.
- **Clavier** : flèches pour changer de jour, `J` journée, `D` demi-journée, `A` absence, `N` non travaillé.

### Décisions prises par défaut (à confirmer)

1. Une journée peut mêler une demi-journée travaillée et une demi-journée d'absence.
2. Un freelance sur plusieurs PO dans le mois a un CRA par PO (onglets en haut de l'écran).
3. Si deux contrats d'un même PO ont des taux différents dans le mois, la soumission est bloquée :
   valoriser jour par jour au taux de chaque contrat demande une décision métier et un changement de schéma.
4. Pas de saisie au-delà du mois en cours ; le mois en cours peut être soumis avec un avertissement.

## Lot 2 — Validation manager

`/validation` : file filtrée par périmètre (un manager ne voit que ses missions ; admin tout ; finance en
lecture), panneau détail avec points d'attention (`lib/domain/attention.ts`), grille du mois en lecture,
historique. « Valider » / « Demander une correction » (motif obligatoire) : transition conditionnée au statut
et à la version, journalisée, e-mail au freelance envoyé après la réponse. « Tout valider » ne valide que les
CRA sans avertissement, chacun recontrôlé côté serveur.

## Lot 3 — Documents

- **Signature** : PNG/JPG ≤ 1 Mo, format vérifié sur le contenu, réencodée et rognée (sharp), obligatoire pour
  soumettre, figée sur le CRA à la soumission.
- **PDF** (`/api/cra/:id/pdf`) : une page A4, filigrane « provisoire » / tampon « validé », jours sur deux
  colonnes, Code 128. **Excel** (`/api/cra/:id/xlsx`, `/api/exports/monthly?mois=AAAA-MM`) : cellules typées.
- **Code d'authenticité** `CRA-MMAA-PO-CLÉ` : HMAC(secret, id | statut | empreinte du contenu figé). Recalculé
  à chaque transition, annulé par une demande de correction, vérifiable publiquement sur `/verify` (détecte
  un document modifié en base ; reconnaît un PDF provisoire remplacé par la version validée).

## Lot 4 — Référentiel & pilotage

- `/freelances` (admin : création / modification ; manager : lecture de son périmètre) : freelances, missions,
  bons de commande, contrats (pas de chevauchement, taux figés dès qu'un CRA est soumis), pièces justificatives
  avec expiration plafonnée par type.
- `/pilotage` : KPI, consommé vs budget par PO, alertes (`lib/domain/alerts.ts`), carte de clôture.
- **Relances** : `POST /api/cron/reminders` (en-tête `Authorization: Bearer $CRON_SECRET`), une fois par jour :
  J-3 avant l'échéance et lendemain de l'échéance, une seule fois par freelance (table `ReminderLog`).

## Lot 5 — Absences & mobile

- `/absences` : déclaration par le freelance (pas de chevauchement, rétroactivité 31 j), Gantt mensuel,
  impact capacitaire par mission avec encart d'arbitrage. Les absences déclarées sont proposées dans le CRA
  (« Abs. ? ») et reportées sur demande.
- **Mobile** : barre supérieure + tiroir, synthèse du mois en tête, cases de 44 px, soumission en bas d'écran.
- **Hors ligne** : copie locale (par utilisateur) des modifications non envoyées, synchronisée au retour du
  réseau ; ignorée si le CRA a changé entre-temps ; effacée à la déconnexion.

## Lot 6 — Durcissement

- **Verrouillage en base** : triggers PostgreSQL interdisant toute modification des jours d'un CRA soumis ou
  validé, et de tout champ d'un CRA validé hors scellement (exception : purge de rétention).
- **Tests de bout en bout** (`e2e/`) : parcours saisie → soumission → validation → PDF → vérification, contrôle
  d'accès par profil, audit axe WCAG 2.1 AA de chaque écran.
  `E2E_DATABASE_URL=postgresql://…/freelancehub_e2e npm run test:e2e` — base dédiée (nom en `_e2e` ou
  `_test`), réinitialisée à chaque exécution ; un serveur `next dev` est lancé sur le port 3300. Avec
  `E2E_BASE_URL`, le serveur indiqué doit tourner sur cette même base (jamais sur la base de dev).
- **RGPD** : `docs/RGPD.md` (registre, durées), `npm run retention`, export JSON des données d'un freelance.
  En production, lancer la purge sous un rôle PostgreSQL dédié et retirer le droit TRUNCATE au rôle applicatif
  (les triggers ne protègent pas contre un accès direct à la base avec des identifiants compromis).
- **Recette** : `docs/RECETTE.md`.

## Exploitation

Variables d'environnement : voir `.env.example` (`AUTH_SECRET`, `AUTH_CODE_SECRET`, `APP_URL`, `SMTP_URL`,
`MAIL_FROM`, `STORAGE_DIR`, `CRON_SECRET`, Entra ID). Tâches planifiées : relances (quotidien),
`npm run retention -- --apply` (mensuel). Le dossier `STORAGE_DIR` doit être sauvegardé avec la base.

## Reste à faire (hors code)

- [ ] Logo définitif (`components/shell/brand-mark.tsx`).
- [ ] Enregistrement de l'application dans Entra ID (tenant de l'entreprise) et mapping des rôles.
- [ ] Validation RH du calendrier des fériés (dates lunaires marquées `tentative`).
- [ ] Validation des durées de conservation par le DPO ; recette avec le panel (`docs/RECETTE.md`).
- [ ] Choix du stockage de production (S3 / Azure Blob) et du serveur SMTP.
