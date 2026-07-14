# Politique d'apprentissage continu API

## Principe

TRADIKOM ONE apprend uniquement a partir de faits structurels, bornes, tracables et approuves. Le systeme ne lance pas de recherche Internet generale, ne deduit pas une autorisation a partir d'une page marketing et ne transforme jamais automatiquement une observation en connecteur actif.

## Entrees autorisees

- Source officielle ajoutee manuellement sur un domaine exact approuve.
- Candidat trouve dans un sitemap borne puis accepte humainement.
- OpenAPI 3.0/3.1, Postman v2.1, SDL/introspection GraphQL fourni ou metadata OAuth officielle.
- Decision humaine sur un claim, un mapping, une approbation sandbox ou une reparation.

Les pages marketing, forums, contenus communautaires et sources tierces ne peuvent pas devenir une preuve technique approuvee dans le flux actuel.

## Cycle de vie

1. Une source est enregistree sous revue.
2. Le domaine et la politique reseau sont verifies avant chaque lecture.
3. Un snapshot immuable conserve provenance et validateurs HTTP.
4. L'analyse produit des claims `under_review`.
5. Un humain approuve ou rejette chaque fait utile.
6. Un mapping tenant approuve reste utilisable seulement tant que sa preuve reste approuvee.
7. Une promotion globale copie uniquement la structure et sa preuve, jamais les donnees tenant.
8. La reutilisation globale cree une nouvelle proposition tenant `pending`.
9. Un changement de source cree un nouvel historique et peut bloquer les propositions affectees.

## Relectures

Les relectures sont desactivees par defaut et limitees aux sources officielles approuvees. Elles utilisent ETag/Last-Modified, des baux, un batch borne, un backoff exponentiel et huit tentatives maximum. Un domaine suspendu, une autorisation revoquee ou une erreur terminale stoppe le reseau et rend l'echec visible.

Les baux expires peuvent etre repris apres redemarrage. Une cle de bail empeche deux workers d'appliquer simultanement la meme relecture. Aucun echec ne declenche une boucle infinie.

## Interdictions

- Pas de crawling sans domaine et source approuves.
- Pas d'activation automatique de connecteur.
- Pas d'approbation heritee entre versions.
- Pas de fusion autoritative OpenAPI/Postman/GraphQL pour les operations.
- Pas d'apprentissage a partir de secrets, payloads clients ou logs bruts.
- Pas de passage de `discovered` a `verified` sans decision et preuve.
- Pas d'assimilation d'un contrat mock a une compatibilite API reelle.

## Retention

Les snapshots encore cites par des claims, preuves, changements ou reparations sont preserves. Les snapshots orphelins de plus de 365 jours, contrats non courants de plus de 180 jours et anciennes propositions non referencees de plus de 365 jours peuvent etre supprimes par la maintenance. Les audits, approbations, preuves actives et historiques de changement utiles ne sont pas supprimes.
