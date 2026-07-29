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

## Liste de suppression

Un échec **définitif** bloque l'adresse pour l'organisation : réessayer n'aboutirait pas, et l'insistance sur des adresses mortes abîme la réputation du domaine d'expédition — dont dépendent tous les envois, y compris ceux qui, eux, arrivent.

La distinction avec un échec **retryable** est le cœur du mécanisme : un 429 ou un 5xx dit que le fournisseur est indisponible, pas que l'adresse est mauvaise. Bloquer sur cette base priverait l'organisation d'un destinataire parfaitement valide. Seul `permanent_failure` alimente la liste.

Le blocage est vérifié **avant** l'écriture de l'invitation : créer une ligne qu'on sait indélivrable ne ferait qu'encombrer la liste des invitations en attente. Le refus remonte en `email_suppressed` (409) avec un message qui dit quoi faire, et l'interface l'affiche comme un cas normal plutôt qu'une page d'erreur.

Une adresse déjà bloquée garde sa **première** cause : c'est elle qui explique pourquoi l'organisation ne peut plus écrire à cette personne, et un second échec ne dit rien de neuf. L'insertion est idempotente (`on conflict do nothing`).

### Portée et réautorisation

La liste est **tenant-scopée**, sous RLS (migrations `075_email_suppressions` / `076_email_suppressions_rls`, miroirs SQL `0069` / `0070`). Elle enregistre l'échec vécu par **une** organisation, pas un verdict partagé : une autre organisation peut toujours écrire à cette adresse. C'est un choix assumé — un registre global respecterait mieux la réalité de la délivrabilité, mais révélerait à une organisation l'existence d'une adresse connue d'une autre.

`Paramètres` → `Adresses bloquées` liste les adresses avec leur cause, le fournisseur, le code d'erreur et la date. Le propriétaire et les administrateurs peuvent réautoriser une adresse corrigée entre-temps. Le geste est explicite et tracé (`email.suppressed`, `email.suppression_released`) : **il n'y a pas d'expiration automatique**, un blocage ne disparaît pas tout seul.

### Ce qui n'est pas bloqué

La réinitialisation de mot de passe n'est **pas** soumise à la liste. Une adresse bloquée reste le seul chemin de récupération d'un compte existant, et le flux de réinitialisation répond déjà de façon identique que le compte existe ou non — y appliquer un blocage introduirait une différence observable.

## Limites actuelles

- Un seul fournisseur réel est implémenté. En ajouter un autre consiste à écrire un module au même contrat, sans toucher aux appelants.
- Pas de webhooks de bounce : la liste de suppression est alimentée par les échecs constatés **au moment de l'envoi**, pas par les rebonds asynchrones signalés plus tard par le fournisseur. Un rebond différé (boîte pleine, domaine expiré constaté après acceptation) n'est donc pas capté.
- Les emails marketing ne passent pas par ce canal ; il est réservé aux transactionnels d'authentification.
