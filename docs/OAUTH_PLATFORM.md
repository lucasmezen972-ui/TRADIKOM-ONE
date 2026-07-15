# Plateforme OAuth

Statut: socle mock, interface, consentement et callback validés; rafraîchissement durable planifié en cours de validation.

Le fournisseur mock CI utilise Authorization Code avec PKCE S256, un état unique stocké uniquement sous forme hachée, une expiration de dix minutes, une consommation atomique anti-rejeu et une redirect URI exacte dérivée de `APP_URL`.

Les vérificateurs PKCE, jetons d'accès et jetons de rafraîchissement sont chiffrés côté serveur avec la clé connecteur et une version de clé explicite. En production, l'absence de clé fait échouer la configuration; en développement et en test, une clé éphémère propre au processus évite tout secret par défaut connu.

Le service prend en charge les scopes minimaux du fournisseur mock, le verrou de rafraîchissement concurrent, la rotation de jetons, la révocation et la déconnexion auditée. Aucun jeton n'est renvoyé au navigateur ni écrit dans les audits.

La maintenance sélectionne au maximum 100 credentials mock arrivant à échéance dans une fenêtre bornée, puis ajoute un événement durable par credential et date d'expiration. L'événement ne contient que les identifiants internes, l'échéance attendue et la corrélation. Le worker ignore une demande devenue obsolète, réutilise le verrou atomique existant et laisse la file commune gérer leases, reprises, tentatives et dead letter.

Le consentement explicite émet un code aléatoire à usage unique dont seul le hash est persisté. Le callback serveur consomme atomiquement l'état et le code, ne renvoie aucun jeton au navigateur et redirige vers un résultat public borné avec cache désactivé et identifiant de corrélation.

L'interface française expose les scopes, l'environnement, l'expiration et la révocation sans jamais révéler un credential. Le parcours Playwright couvre connexion, consentement, visibilité des scopes et déconnexion. Les tests worker vérifient la planification idempotente, l'absence de jeton dans l'événement et la rotation effective.

Ce fournisseur est une fixture locale sans réseau, sans donnée client et sans écriture. Il ne constitue ni une validation sandbox officielle ni une connexion de production.
