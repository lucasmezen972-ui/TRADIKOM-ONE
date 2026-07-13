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

Un hash identique pour une meme source reutilise le snapshot existant. Une reponse `304 Not Modified` reutilise la derniere version locale.

## Donnees non fiables

Le contenu distant n'est jamais interprete comme une instruction. Aucun code, script, exemple ou reference externe n'est execute. Les valeurs ressemblant a des credentials sont redigees avant stockage; les exemples et valeurs par defaut sont retires des schemas importes.

## Interdictions

- Authentification, paywall ou tableau de bord prive.
- Domaine non approuve ou sous-domaine implicite.
- Endpoint local, prive, metadata ou redirection.
- Reference OpenAPI externe.
- Secret trouve dans une documentation.
- Activation ou appel d'ecriture d'un connecteur genere.
