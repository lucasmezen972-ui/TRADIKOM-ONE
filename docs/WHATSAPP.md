# Messages WhatsApp

WhatsApp est le canal réel des entreprises locales aux Antilles. La fiche contact propose donc des messages prêts à envoyer, sans dépendre d'une API tierce.

## Ce que fait — et ne fait pas — TRADIKOM ONE

Le produit construit un lien « click to chat » (`https://wa.me/<numéro>?text=<message>`). WhatsApp s'ouvre avec le message pré-rempli ; **le dirigeant le relit et l'envoie lui-même**.

Aucun message ne transite par TRADIKOM ONE, aucun envoi n'est automatisé, aucune donnée n'est transmise à Meta par le serveur. Cela respecte la règle du cahier des charges : toute communication générée doit être vérifiable avant envoi.

C'est aussi un choix pragmatique : l'API WhatsApp Business impose un compte vérifié, des modèles pré-approuvés et une facturation par conversation. Le lien direct fonctionne immédiatement, pour toutes les entreprises, sans démarche.

## Modèles

| Clé | Usage |
| --- | --- |
| `lead_follow_up` | premier contact après une demande reçue sur le site |
| `opportunity_follow_up` | relance d'un devis en attente, avec le montant si connu |
| `appointment_reminder` | confirmation d'un rendez-vous |
| `review_request` | demande d'avis après une prestation |
| `after_sale` | suivi après-vente |

Les messages reprennent le prénom tel qu'il figure dans la fiche et le nom de l'organisation. Ils restent courts : ils sont relus avant envoi.

## Numéros

`normalizePhone` accepte les formats réellement saisis aux Antilles : `0696 10 20 30`, `+596 696 10 20 30`, `00596...`, avec ou sans espaces. Un numéro national perd son `0` de service au profit de l'indicatif pays (`596` par défaut, configurable par appel pour les organisations hors Antilles).

Les bornes E.164 sont vérifiées : moins de 8 ou plus de 15 chiffres, le numéro est rejeté et aucune suggestion n'est proposée. Une fiche sans numéro exploitable affiche un message explicite plutôt qu'un lien cassé.

## Sécurité

Le message est encodé avec `encodeURIComponent` : un texte contenant `&phone=` ou `&text=` ne peut pas forger de paramètre supplémentaire dans l'URL — un test le vérifie explicitement. La longueur est bornée à 1 000 caractères.

Les liens s'ouvrent avec `rel="noreferrer noopener"`.

## Limites actuelles

- Pas d'historique des messages envoyés : l'envoi a lieu dans WhatsApp, hors du produit, donc rien ne peut être journalisé de façon fiable.
- Pas d'envoi groupé ni programmé — ce serait un envoi automatique, exclu par conception.
- Les modèles ne sont pas personnalisables depuis l'interface.
- Le lien suppose que WhatsApp est installé, ou bascule sur WhatsApp Web.
