# Plateforme OAuth

Statut: socle mock implémenté, interface et routes de callback en cours.

Le fournisseur mock CI utilise Authorization Code avec PKCE S256, un état unique stocké uniquement sous forme hachée, une expiration de dix minutes, une consommation atomique anti-rejeu et une redirect URI exacte dérivée de `APP_URL`.

Les vérificateurs PKCE, jetons d'accès et jetons de rafraîchissement sont chiffrés côté serveur avec la clé connecteur et une version de clé explicite. En production, l'absence de clé fait échouer la configuration; en développement et en test, une clé éphémère propre au processus évite tout secret par défaut connu.

Le service prend en charge les scopes minimaux du fournisseur mock, le verrou de rafraîchissement concurrent, la rotation de jetons, la révocation et la déconnexion auditée. Aucun jeton n'est renvoyé au navigateur ni écrit dans les audits.

Ce fournisseur est une fixture locale sans réseau, sans donnée client et sans écriture. Il ne constitue ni une validation sandbox officielle ni une connexion de production. Les routes serveur, l'interface française et le parcours Playwright restent à terminer dans le checkpoint suivant.
