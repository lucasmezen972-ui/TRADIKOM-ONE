# Modele de securite API Intelligence

## Frontieres de confiance

Les documents distants sont des donnees non fiables. Ils ne sont jamais traites comme des instructions, du code ou une autorisation. Une source ne devient lisible qu'apres approbation humaine du domaine exact et verification de la politique reseau.

Les donnees globales du repertoire logiciel sont administrees par un `platform_admin`. Les analyses, mappings, propositions, approbations et impacts tenant restent autorises et filtres par `tenant_id`. Les propositions de connecteurs restent desactivees dans tous les etats disponibles.

## Acces reseau

- HTTPS et port 443 uniquement.
- Domaine exact approuve; pas de sous-domaine implicite.
- Aucun identifiant, fragment ou parametre sensible dans l'URL.
- Toutes les reponses DNS sont verifiees; une reponse mixte ou privee est refusee.
- L'adresse publique validee est epinglee pendant la connexion TLS.
- Loopback, link-local, reseaux prives, metadata cloud et IPv4 mappee en IPv6 sont bloques.
- Les redirections et contenus compresses sont refuses.
- Delai, taille, frequence, profondeur et nombre de documents sont bornes.
- `robots.txt` et une autorisation plateforme encore active sont verifies avant le fetch.

## Analyseurs

OpenAPI et YAML refusent les references externes, alias excessifs, recursion excessive et documents surdimensionnes. Postman n'execute ni scripts, ni requetes, et ne conserve aucune valeur d'authentification. GraphQL accepte seulement un SDL ou un resultat d'introspection fourni; aucune introspection distante n'est lancee. OAuth ne lance aucun flux et ne contacte aucun endpoint de token.

Les exemples, valeurs par defaut sensibles, corps, credentials et metadonnees signees sont retires avant persistance. Les journaux conservent des codes bornes, jamais le contenu distant brut.

## Etats et preuves

- `discovered`: ressource candidate, non verifiee et non importee.
- `under_review`: contenu importe structurellement, sans approbation.
- `approved`: decision humaine sur une preuve precise et versionnee.
- `verified`: source officielle verifiee, pas connecteur teste.
- `approved_for_sandbox`: contrats mock reussis et decision sandbox; aucune activation.
- `ready_now`: reserve a un connecteur approuve pour la production. Aucun flux actuel ne produit cet etat.
- `stale` ou `blocked`: relecture en retard, terminale ou autorisation retiree; cet etat n'implique pas que le dernier contrat est faux.

Une confiance elevee de parseur n'est jamais une approbation. Une preuve approuvee cesse d'autoriser un mapping ou une proposition si son claim est rejete. Une nouvelle version de snapshot cree de nouvelles preuves sous revue.

## Connector Copilot

La generation exige des metadonnees, operations et mappings encore soutenus par des claims approuves. Les modes d'authentification inconnus et les operations hors format sont refuses. Le manifeste est valide, borne, sans secret, avec delais, retries limites et idempotence pour les ecritures.

Les contrats sont deterministes et mock. Une approbation porte uniquement sur le sandbox, garde `enabled = false` et n'autorise ni installation, ni credentials, ni ecriture externe. Une rupture API bloque la proposition affectee et exige une nouvelle version, de nouveaux contrats et une nouvelle decision.

## Journalisation et incidents

Les mutations sensibles produisent un audit. Les fetches, imports, mappings, propositions, contrats, approbations, changements et reparations propagent un identifiant de correlation lorsqu'un traitement asynchrone est implique. Les erreurs publiques passent par un mapping sur; les stacks, SQL, URLs credentialees, tokens et payloads complets ne sont jamais retournes.
