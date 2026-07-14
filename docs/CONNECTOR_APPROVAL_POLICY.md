# Politique d'approbation des connecteurs

## Principe

Connector Copilot produit une proposition, jamais un connecteur actif. La colonne `enabled` reste a `false` a chaque transition du premier parcours.

## Conditions de generation

Une proposition exige:

- un produit API importe depuis un snapshot officiel;
- des metadonnees, operations et schemas approuves avec leurs preuves;
- au moins un mapping tenant approuve dont le claim de preuve reste approuve;
- une analyse `custom_connector_possible`;
- un administrateur plateforme autorise sur le tenant.

Le manifeste contient des delais, une strategie de retry, la gestion d'idempotence pour les ecritures et les seules operations approuvees. Un type d'authentification inconnu, une operation hors methode HTTP autorisee ou un chemin non absolu bloque la generation.

## Tests de contrat

Le mode par defaut est `mock`. Les resultats et journaux surs sont persistes avec les versions du connecteur, de l'API et de la suite. Une soumission est refusee tant que le dernier run n'est pas reussi.

Aucun test de ce checkpoint ne contacte Internet, ne lit un credential tenant ou n'execute une ecriture reelle.

## Approbation sandbox

La demande porte explicitement la portee `sandbox`. La decision:

- exige le role administrateur plateforme;
- est enregistree et auditee;
- peut approuver ou bloquer la proposition;
- ne change jamais `enabled`;
- cree une entree privee uniquement apres approbation.

L'entree du Connect Store indique `approved_for_sandbox` et `not_installed`.

## Changement de contrat API

Un changement de rupture ou de securite compare le manifeste aux operations du
nouveau snapshot. Si le connecteur est affecte:

- `enabled` reste a `false` et le statut devient `change_review_required`;
- un run `api-change-1` persiste uniquement des resultats et journaux surs;
- un plan de reparation desactive est cree dans l'impact tenant;
- une decision humaine approuve ou rejette ce plan et est auditee;
- aucune decision ne declenche une activation ou une mise a niveau automatique.

Une approbation de plan autorise uniquement la poursuite du travail de
regeneration. Le blocage n'est leve qu'apres une future regeneration, des tests
sandbox reussis et une decision distincte.

## Production

L'approbation, l'installation et l'activation production sont volontairement absentes. Elles devront faire l'objet d'un flux distinct avec revue de securite, credentials chiffres, sandbox reel, tests sans ecriture puis autorisation explicite. Un connecteur sandbox ne doit jamais etre presente comme `ready_now`.
