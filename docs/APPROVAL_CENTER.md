# Centre d'approbation

La page `/validations` réunit en un seul endroit les actions que TRADIKOM ONE a préparées et qui attendent une décision humaine. Elle répond à la quatrième question du centre de pilotage : « quelles actions TRADIKOM ONE peut-il préparer pour moi ? ».

## Périmètre

Cinq familles de propositions IA y sont agrégées :

| Famille | Origine | Page de détail |
| --- | --- | --- |
| Décision stratégique | Conseiller stratégique | `/conseiller-strategique` |
| Campagne marketing | Marketing autonome | `/marketing` |
| Contenu du site | Website AI | `/mon-site` |
| Réponse à un avis | Réputation | `/reputation` |
| Veille concurrentielle | Veille concurrents | `/veille-concurrentielle` |

Les approbations de **workflow** et de **connecteur** restent sur leurs écrans dédiés (`/automatisations`, `/intelligence-api`) : elles s'accompagnent de contrôles propres — reprise, file d'attente, sandbox — qui n'auraient pas de sens hors contexte.

## Lecture agrégée, décision déléguée

Le module `src/modules/approval-center` ne fait que **lire**. Chaque décision est transmise à la server action du module concerné, qui conserve ses propres gardes : vérification de rôle spécifique, transaction, écriture d'audit et effets de bord (par exemple l'application d'un brouillon de site approuvé).

Aucune route générique « approuver n'importe quoi » n'existe : elle contournerait ces gardes.

La requête part toujours de la table `approvals`, seule source autoritaire de ce qui reste à décider ; le contenu de la proposition est joint depuis la table du module. Une proposition déjà décidée disparaît donc immédiatement de la file.

## Ce que voit le dirigeant

Chaque carte présente le problème détecté, la justification, le résultat attendu, les points de vigilance et, lorsque le module la calcule, la confiance en pourcentage. Un motif est obligatoire (5 à 500 caractères) pour approuver comme pour refuser — la décision reste traçable.

L'historique des décisions récentes est affiché sous la file, toutes familles confondues.

## Rôles

Seuls `owner`, `administrator` et `manager` accèdent au contenu, alignés sur la règle du tableau de bord. Un collaborateur reçoit une file vide et un message explicite : il ne doit pas voir le détail d'une décision qu'il ne peut pas prendre.

## Retour après décision

Les server actions de décision acceptent un champ `retour`. Sa valeur est validée contre une allowlist (`/validations` uniquement) avant redirection : le champ vient d'un formulaire et ne doit jamais permettre une redirection ouverte. Sans ce champ, chaque action redirige vers sa page d'origine comme avant.

## Limites actuelles

- Le contenu d'une proposition ne peut pas être modifié depuis le centre ; la modification reste sur la page du module, qui connaît la forme exacte de l'objet.
- Le report d'une décision (« reporter à plus tard ») n'est pas implémenté : une proposition est approuvée ou refusée.
- La file est bornée à 25 propositions et l'historique à 15 décisions.
