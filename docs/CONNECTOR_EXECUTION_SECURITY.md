# Sécurité d'exécution des connecteurs

Statut: première exécution mock en lecture seule validée par les runs complets Phase 5, notamment `29380786047` et `29382920239`.

Le policy engine vérifie avant chaque opération le tenant, l'installation, son statut, la version du connecteur, la version API, l'environnement, l'opération approuvée, la capacité lecture/écriture, les scopes, l'expiration des credentials, les quotas, les suspensions de sécurité, les ruptures API et les approbations ouvertes.

Une connexion OAuth ne suffit pas à exécuter un connecteur. L'administrateur doit d'abord créer une installation `installed_disabled`, puis activer explicitement `read_only_enabled`. Les seules opérations approuvées sont `contacts.list` et `profile.read` sur la fixture `mock_business`.

Chaque exécution réserve une clé d'idempotence avant de consommer le quota ou d'appliquer l'effet. Elle conserve installation, version, environnement, opération, capacité, corrélation, horaires, statut, résultat sûr, erreur classifiée, tentatives et quota restant. Les payloads et secrets sont exclus des résultats et audits.

Le worker passe par le même policy engine; l'ancien contrôle direct de synchronisation n'est plus exposé. La santé affiche uniquement des états bornés, des versions, des horaires, la latence, le quota et une action recommandée.

Seul l'environnement `mock` est opérationnel. Le sandbox officiel et la production restent désactivés. Aucune écriture externe ou production n'est disponible.
