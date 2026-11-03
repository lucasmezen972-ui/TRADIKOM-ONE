# Verrou de publication et de suppression d'image

Contrat ajouté après le correctif des images publiques du 3 novembre 2026
(source initiale `261efe488cd3cf5dcc4b53a701ab2cec2da848ef`).

`publishWebsite` et `deleteTenantAsset` utilisent la même ligne `tenants.id`
avec `SELECT ... FOR UPDATE`, après vérification du membership et du rôle,
dans une transaction tenant/acteur sans accès SYSTEM. Le verrou précède la
lecture du snapshot ou des références et reste acquis jusqu'au commit ou
rollback des mutations et de leur audit. Le contrat vise les transactions
applicatives habituelles PostgreSQL en isolation READ COMMITTED.

La suppression suit cet ordre : autorisation, verrou tenant, lecture des
références du brouillon/profil/dernière publication du tenant, DELETE de la
métadonnée, audit logique `asset.deleted`, commit, puis suppression des octets.
Aucun accès au stockage n'est effectué pendant la détention du verrou.

| Échec | État attendu |
| --- | --- |
| Accès refusé | Aucun verrou de mutation ni accès au stockage |
| Image encore utilisée | Ligne et octets conservés, transaction annulée |
| Échec de l'audit | DELETE et audit annulés ensemble ; stockage intact |
| Échec du stockage après commit | Ligne retirée et audit logique conservé ; octets orphelins invisibles possibles ; erreur propagée si l'adaptateur la signale |

`deleteTenantAsset` doit posséder sa transaction. Un client marqué
`__transaction: true` est refusé avant SQL et stockage avec le code métier
`asset_transaction_not_supported` ; ce service ne dispose pas de hook de
commit externe. Le chemin UI normal utilise le client de requête tenant,
puis la transaction propre au service.

La régression locale sous rôle non-superuser et sans BYPASSRLS vérifie l'ordre
des requêtes, le verrou paramétré du même tenant dans les deux services,
l'audit atomique, les deux modes d'échec, le refus intertenant et le nettoyage
du contexte. Elle n'exécute pas une course sur deux connexions PostgreSQL
distantes et ne constitue pas une preuve de concurrence hébergée.

La protection est bornée aux deux services. Les éditeurs de brouillon et les
écritures SQL directes ne prennent pas ce verrou ; aucune sérialisation de
toutes les modifications du site n'est revendiquée. Le verrou tenant peut
brièvement faire attendre d'autres opérations prenant un verrou incompatible,
notamment certaines vérifications de clés étrangères. Aucun nouveau droit,
aucune politique RLS et aucune migration ne sont nécessaires.
