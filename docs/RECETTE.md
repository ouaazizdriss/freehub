# Recette avec un panel de freelances

Panel conseillé : 5 freelances (dont un sur mobile, un sur deux missions, un utilisateur de lecteur d'écran),
2 managers, 1 admin achats, 1 contrôleur finance. Durée : une clôture mensuelle réelle (du 25 au 5).

## Scénarios

| # | Profil | Scénario | Attendu |
|---|---|---|---|
| 1 | Freelance | Saisir un mois complet au clavier (flèches, J/D/A/N) | Totaux et montant justes, enregistrement automatique |
| 2 | Freelance | Demi-journée + demi-absence, heures sup., astreinte | Montant = jours × TJM + HS × taux + astreintes × forfait |
| 3 | Freelance | Travailler un samedi sans motif puis avec motif | Soumission bloquée puis autorisée |
| 4 | Freelance | Déclarer une absence, la reporter dans le CRA | Cases « Abs. ? » puis absence |
| 5 | Freelance (mobile) | Saisir en mode avion puis retrouver le réseau | Saisie conservée et synchronisée |
| 6 | Freelance | Déposer la signature, soumettre, télécharger le PDF | PDF d'une page, mention « provisoire » |
| 7 | Manager | Valider un CRA, demander une correction sur un autre | E-mails reçus, CRA renvoyé modifiable |
| 8 | Manager | « Tout valider » | Seuls les CRA sans avertissement sont validés |
| 9 | Finance | Vérifier un PDF validé sur `/verify` ; vérifier un PDF provisoire remplacé | « Authentique » ; « Version remplacée » |
| 10 | Admin | Créer freelance, mission, PO, contrat ; déposer une pièce | Statuts et alertes cohérents |
| 11 | Admin | Export Excel du mois | Une ligne par CRA, montants typés |
| 12 | Tous | Tenter d'ouvrir une page ou un document hors périmètre | Accès refusé / introuvable |

## Critères de sortie

- 0 anomalie bloquante, anomalies majeures corrigées ou acceptées par le métier.
- Questionnaire (SUS ≥ 75) et temps de saisie d'un mois < 3 minutes pour 4 freelances sur 5.
- Écart nul entre les montants de l'export Excel et les factures du mois testé.
