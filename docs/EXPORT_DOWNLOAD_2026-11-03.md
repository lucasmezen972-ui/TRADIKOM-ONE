# Export réel, contraste et préchargement — 3 novembre2026

Sur la preview protégée du source `c8817c6ec849ba6fb0e4705c8f8c0e37801b1073`, le job existant `export_7c920f7be46344a6bd07c8fa94bc848d` a été sélectionné puis généré explicitement. Rechargement : fichier disponible,3lignes. Téléchargement natif :259octets, colonnes Nom/E-mail/Statut, trois adresses fictives et aucun identifiant technique.

SHA256 du fichier et du payload SQL identiques : `54714450fc66b625cbaea00560c2c067ee0f43655050f82fe3430e6899b8faa8`. SQL distinct : statut completed, trois lignes, un seul audit export.completed. Aucun nouveau job demandé ni drainage de file.

## Défauts supplémentaires réellement observés

Le lien de téléchargement porte text-white mais sa couleur calculée est lab(1.76974 1.32743 -9.28855), sur fond lab(16.132 -0.318035 -14.6672). La règle globale a hors layer écrase l’utilitaire de couleur. Correctif borné : déplacer cette seule règle dans le layer base, sans toucher aux contrôles ou fontes.

Les événements export.downloaded sont des requêtes serveur, pas une mesure fiable des clics humains. Il y en avait6 après une seule action native de téléchargement ; un simple rechargement sans clic les fait passer de6 à7 (dernier événement19:46:09.204Z). Les sept événements historiques sont conservés. Le lien Next est préchargé automatiquement ; correctif : désactiver son prefetch. L’autorisation du endpoint, ses limites et son audit serveur sont conservés.

Références primaires : [styles de base Tailwind](https://tailwindcss.com/docs/adding-custom-styles#adding-base-styles) et [Link App Router/prefetch](https://nextjs.org/docs/app/api-reference/components/link#prefetch). Ces mécanismes ne remplacent pas la preuve native rouge ci-dessus.

## Qualification attendue du complément

Les deux corrections de présentation ne modifient ni services, actions, SQL, tests ou dépendances. Le corpus203 fichiers continue sur c881 ; ne pas lui attribuer un SHA différent. Le nouveau build fournisseur doit qualifier le complément, puis les contrôles natifs doivent confirmer texte clair et audits inchangés lors d’un affichage/rechargement, avec événement ajouté au clic explicite. Résultats encore à vérifier, aucun vert anticipé.

Compte/tenant/session conservés, base134, IA désactivée/budgets0/0, aucun message externe ou nouveau budget. Migration135 toujours non appliquée après expiration native.


## Résultat intermédiaire du complément8612862

Build fournisseur READY. La couleur calculée devient rgb(255,255,255) sur rgb(8,17,31), capture native enregistrée. Affichage puis rechargement : compteur audit7→7→7, préchargement éliminé. Clic explicite : compteur7→9, contenu259octets/hash identique. La navigation client Next émet encore deux requêtes au clic; ne pas annoncer un événement par clic. Le lien est donc remplacé par une ancre native avec attribut download, toujours vers le même endpoint autorisé. Dernière recette de cette ancre encore à faire.
