# Fournisseur email

Les emails transactionnels — réinitialisation de mot de passe et invitation d'équipe — passent par l'abstraction `EmailProvider` (`src/modules/email/types.ts`). Chaque envoi retourne un résultat typé : `sent`, `retryable_failure` ou `permanent_failure`, avec un code d'erreur sûr et un délai de reprise éventuel.

## Fournisseurs disponibles

| `EMAIL_PROVIDER` | Usage | Production |
| --- | --- | --- |
| `console` | développement local, journalise une empreinte du destinataire | refusé sauf opt-in explicite `ALLOW_CONSOLE_EMAIL_IN_PRODUCTION` |
| `test` | suites automatisées, capture les messages en mémoire | refusé |
| `resend` | envoi réel via l'API Resend | oui |
| *(non renseigné en production)* | `unavailable` : échec retryable, aucun envoi | — |

## Configuration de `resend`

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=<clé du fournisseur>
EMAIL_FROM=contact@votre-domaine.fr
```

Les deux variables sont exigées par la validation d'environnement **dans tous les environnements**, pas seulement en production : un fournisseur réel sélectionné sans clé échouerait silencieusement à l'exécution. L'adresse d'expédition doit appartenir à un domaine vérifié chez le fournisseur.

## Posture de sécurité

- **Origine fixe.** `https://api.resend.com/emails` est une constante du code, jamais lue depuis l'environnement : une URL configurable ouvrirait une surface SSRF sur une requête qui porte la clé d'API en en-tête.
- **Redirections refusées** (`redirect: "error"`), délai d'attente de 10 secondes, lecture de réponse bornée à 8 Kio.
- **Aucune fuite.** Ni la clé, ni l'adresse du destinataire, ni le corps de la réponse du fournisseur ne se retrouvent dans le résultat retourné. Seuls des codes d'erreur internes sont propagés (`rate_limited`, `provider_unavailable`, `provider_unauthorized`, `message_rejected`, `network_error`). Un test vérifie explicitement cette non-divulgation.
- **Idempotence.** Chaque message porte une clé dérivée du type, de l'invitation et de l'expiration : une reprise du worker ne renvoie pas deux fois le même lien.

## Classification des erreurs

| Réponse | Résultat | Raison |
| --- | --- | --- |
| 2xx | `sent` | identifiant extrait si la réponse est du JSON exploitable |
| 429 | `retryable_failure` | `retry-after` respecté s'il est plausible, 60 s sinon |
| 5xx | `retryable_failure` | panne côté fournisseur, reprise à 300 s |
| 401 / 403 | `permanent_failure` | une clé invalide ou révoquée ne se répare pas en réessayant |
| autres 4xx | `permanent_failure` | message refusé (destinataire ou charge utile invalide) |
| erreur réseau, délai dépassé | `retryable_failure` | reprise à 300 s |

## Limites actuelles

- Un seul fournisseur réel est implémenté. En ajouter un autre consiste à écrire un module au même contrat, sans toucher aux appelants.
- Pas de gestion des webhooks de bounce ni de suppression list : un destinataire invalide est constaté au moment de l'envoi.
- Les emails marketing ne passent pas par ce canal ; il est réservé aux transactionnels d'authentification.
