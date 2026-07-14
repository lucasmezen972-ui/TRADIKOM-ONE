# Politique des sources API

## Sources autorisees

Une source distante n'est accessible que lorsque:

- le domaine exact a ete ajoute puis approuve par un administrateur plateforme;
- l'URL utilise HTTPS sur le port standard;
- l'URL ne contient ni identifiants, ni fragment;
- le domaine editeur correspond au logiciel enregistre;
- `robots.txt` autorise le chemin;
- la limite de frequence du domaine est disponible.

La version actuelle accepte les specifications OpenAPI 3.0/3.1, collections Postman v2.1, schemas GraphQL fournis et metadonnees OAuth officielles. Une source peut etre ajoutee manuellement ou proposee par le scan borne d'un sitemap du domaine exact approuve. Le systeme ne lance ni recherche generale, ni exploration recursive du Web.

## Controles reseau

- Resolution de toutes les adresses DNS avant la requete.
- Refus de toute reponse DNS contenant une adresse privee, loopback, link-local, reservee pour les metadata ou non valide.
- Connexion epinglee sur l'adresse validee avec verification TLS du nom officiel.
- Refus des redirections et des encodages compresses.
- Delai de 10 secondes avec annulation effective.
- Taille maximale de 128 Kio pour `robots.txt` et 1 Mio pour une source.
- User-Agent identifiable `TradikomApiScout/1.0`.

## Provenance

Chaque contenu accepte conserve:

- l'URL canonique et le domaine editeur;
- la classification officielle de la source;
- la date et le statut HTTP;
- ETag et Last-Modified;
- le hash SHA-256 du contenu redige;
- la version du parseur;
- les decisions robots et politique d'acces;
- des metadonnees bornees sans secret.

Chaque nouvelle observation HTTP 200 conserve un snapshot, meme si le hash du contenu est identique, afin de suivre les changements d'ETag, Last-Modified et de politique. Une reponse `304 Not Modified` reutilise la derniere version locale sans dupliquer le snapshot.

Lorsqu'un nouveau contrat est importe, les preuves historiques encore citees par un mapping approuve sont conservees. Les nouvelles operations, schemas, claims et preuves sont identifies par snapshot et restent sous revue; une approbation precedente ne s'applique jamais implicitement a une nouvelle version.

## Relectures planifiees

- La planification est desactivee tant qu'un administrateur plateforme ne l'active pas explicitement.
- Seules les sources classees officielles sur un domaine encore approuve sont eligibles.
- Le worker traite un batch borne de trois sources, sequentiellement, avec un bail unique par execution.
- Un bail expire est repris apres un delai; les erreurs transitoires suivent un backoff exponentiel et respectent `Retry-After`.
- Un domaine suspendu, une source non officielle ou une autorisation revoquee desactive la planification avant toute requete.
- Les echecs ne conservent qu'un code borne; aucun message reseau brut, contenu ou secret n'est stocke dans la planification.

## Decouverte par sitemap

- Le scan exige un administrateur plateforme, un tenant actif autorise et un domaine exact approuve.
- Seules les declarations `Sitemap` de `robots.txt` ou `/sitemap.xml` sont lues, sans redirection.
- Chaque document XML est limite a 512 Kio; un scan lit au plus cinq documents, a une profondeur maximale de deux, et conserve au plus 100 candidats.
- Les sous-domaines, ports non standards, identifiants, fragments et parametres sensibles sont refuses; les parametres de suivi sont retires et les doublons canonicalises.
- Une limite de six scans par heure s'applique par utilisateur et domaine.
- Un candidat accepte cree seulement une source officielle sous revue. Son contenu n'est ni recupere ni importe automatiquement.

## Donnees non fiables

Le contenu distant n'est jamais interprete comme une instruction. Aucun code, script, exemple, requete ou reference externe n'est execute. Les valeurs ressemblant a des credentials sont redigees avant stockage; les exemples et valeurs par defaut sont retires des schemas importes.

Pour Postman, seules la structure des dossiers, les methodes, chemins, noms de parametres, types d'authentification et metadonnees bornees des exemples/scripts sont conserves. Les valeurs de variables et d'authentification, corps de requetes, corps de reponses et code des scripts ne sont jamais persistes.

Pour GraphQL, la source doit contenir un SDL ou un resultat d'introspection JSON deja fourni. Le systeme n'envoie jamais de requete d'introspection a un endpoint. Seuls les types, champs, arguments et signatures d'operations sont conserves; descriptions, raisons de deprecation et valeurs par defaut sont omises des claims structurels.

Pour OAuth, la source doit etre un document JSON officiel d'autorisation-server metadata. Les endpoints structurels HTTPS publics, grants, scopes, methodes client et signaux PKCE peuvent etre conserves; credentials, jetons et metadonnees signees sont rediges avant stockage. Aucun endpoint OAuth n'est appele pendant l'analyse.

## Interdictions

- Authentification, paywall ou tableau de bord prive.
- Domaine non approuve ou sous-domaine implicite.
- Endpoint local, prive, metadata ou redirection.
- Exploration de liens HTML, recherche generale, sous-domaine implicite ou import automatique d'un candidat sitemap.
- Reference OpenAPI externe.
- Remplacement croise OpenAPI/Postman d'un produit possedant deja des operations importees.
- Introspection GraphQL en direct ou execution d'une operation GraphQL.
- Execution d'un flux OAuth, appel d'un endpoint de token/revocation ou decodage d'une metadonnee signee.
- Secret trouve dans une documentation.
- Activation ou appel d'ecriture d'un connecteur genere.
