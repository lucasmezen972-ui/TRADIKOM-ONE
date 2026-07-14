# Sécurité d'exécution des connecteurs

Statut: la Phase 4 conserve ses plans désactivés; aucune exécution de connecteur Phase 5 n'est encore activée.

Avant chaque future opération, le moteur devra vérifier le tenant, l'installation, la version, l'environnement, l'opération approuvée, les scopes, les credentials, les limites, les changements API et les approbations ouvertes.

Le premier environnement opérationnel sera `mock`, suivi d'un sandbox officiel borné. La production restera en lecture seule et désactivée par défaut. Une écriture production nécessitera un verrou séparé hors du premier jalon.
