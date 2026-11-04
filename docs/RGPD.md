# Données personnelles (RGPD)

Registre simplifié des traitements de Freelance Hub, à faire valider par le DPO avant la mise en production.

## Finalités et base légale

| Traitement | Finalité | Base légale |
|---|---|---|
| Comptes (nom, e-mail, rôle) | Authentification SSO, habilitations | Exécution du contrat de prestation |
| CRA (jours, heures sup., astreintes, commentaires, motifs) | Facturation des prestations, contrôle du service fait | Exécution du contrat ; obligation comptable |
| Signature (image) | Apposition sur le PDF du CRA | Exécution du contrat |
| Pièces justificatives (URSSAF, assurance, Kbis) | Obligation de vigilance du donneur d'ordre | Obligation légale (C. trav. L8222-1) |
| Absences | Plan de charge, capacité des missions | Intérêt légitime (organisation des missions) |
| Journal d'audit | Traçabilité des validations et téléchargements | Intérêt légitime ; preuve |

Aucune donnée n'est utilisée à d'autres fins, ni transmise hors de l'entreprise (hors sous-traitants
d'hébergement et d'envoi d'e-mails, à lister dans le registre officiel).

## Minimisation

- Les commentaires d'absence ne sont visibles que du freelance (le Gantt manager n'affiche que type et dates,
  bornés à la période de rattachement à la mission).
- Les composants navigateur ne reçoivent que les champs affichés (pas d'e-mail, de clé de stockage, de budget PO).
- Les fichiers déposés sont réencodés (signature) ou contrôlés sur leur contenu (pièces), stockés hors de l'espace
  web public, et toujours servis en pièce jointe après contrôle d'accès.

## Durées de conservation

Appliquées par `npm run retention -- --apply` (simulation sans `--apply`), à planifier chaque mois.

| Donnée | Durée | Référence |
|---|---|---|
| CRA, jours, totaux, PDF (reconstruits à la demande) | 10 ans | Code de commerce L123-22 |
| Journal d'audit des transitions | 10 ans | Suit les CRA |
| Traces de téléchargement, relances | 1 an | Minimisation |
| Absences | 3 ans après la fin | Minimisation |
| Pièces justificatives | 5 ans après expiration | Prescription (vigilance) |
| Comptes désactivés sans contrat depuis 3 ans | Anonymisés (nom, e-mail, société, SIRET, signature) | Minimisation |
| Images de signature remplacées et jamais figées | Supprimées (délai de grâce 24 h) | Minimisation |

Les CRA conservés gardent l'instantané du document (noms figés à la soumission) : l'anonymisation d'un compte ne
modifie pas une pièce comptable émise.

## Droits des personnes

- **Accès / portabilité** : le freelance télécharge ses données (JSON) depuis « Mes missions » ; l'admin depuis la
  fiche du freelance. Chaque export est journalisé (`RGPD_EXPORT`).
- **Rectification** : par l'admin (fiche freelance) ; un CRA validé n'est plus modifiable (pièce comptable).
- **Effacement** : limité par les obligations comptables (10 ans) ; anonymisation des comptes inactifs.

## Sécurité

Voir `docs/SECURITE.md` (rapport d'audit) : contrôle d'accès par rôle et périmètre côté serveur, verrouillage
des CRA soumis/validés en base, codes d'authenticité HMAC, en-têtes de sécurité, journal d'audit.
