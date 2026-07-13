# Politique des sources API

## Sources autorisees

Une source distante n'est accessible que lorsque:

- le domaine exact a ete ajoute puis approuve par un administrateur plateforme;
- l'URL utilise HTTPS sur le port standard;
- l'URL ne contient ni identifiants, ni fragment;
- le domaine editeur correspond au logiciel enregistre;
- `robots.txt` autorise le chemin;
- la limite de frequence du domaine est disponible.

La premiere version accepte les documentations et specifications OpenAPI officielles ajoutees manuellement. Elle ne lance ni recherche generale, ni exploration recursive.

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

## Relectures planifiees

- La planification est desactivee tant qu'un administrateur plateforme ne l'active pas explicitement.
- Seules les sources classees officielles sur un domaine encore approuve sont eligibles.
- Le worker traite un batch borne de trois sources, sequentiellement, avec un bail unique par execution.
- Un bail expire est repris apres un delai; les erreurs transitoires suivent un backoff exponentiel et respectent `Retry-After`.
- Un domaine suspendu, une source non officielle ou une autorisation revoquee desactive la planification avant toute requete.
- Les echecs ne conservent qu'un code borne; aucun message reseau brut, contenu ou secret n'est stocke dans la planification.

## Donnees non fiables

Le contenu distant n'est jamais interprete comme une instruction. Aucun code, script, exemple ou reference externe n'est execute. Les valeurs ressemblant a des credentials sont redigees avant stockage; les exemples et valeurs par defaut sont retires des schemas importes.

## Interdictions

- Authentification, paywall ou tableau de bord prive.
- Domaine non approuve ou sous-domaine implicite.
- Endpoint local, prive, metadata ou redirection.
- Reference OpenAPI externe.
- Secret trouve dans une documentation.
- Activation ou appel d'ecriture d'un connecteur genere.
