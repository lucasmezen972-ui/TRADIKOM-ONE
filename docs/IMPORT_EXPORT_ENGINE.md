# Moteurs d'import et d'export

Statut: import et export universels implémentés, validation CI en cours.

## Import universel

- Formats acceptés: CSV, JSON et XLSX.
- Limites: 5 Mo, 10 000 lignes, 100 colonnes et 10 000 caractères par cellule.
- Les types de contenu et la signature XLSX sont vérifiés avant parsing.
- Le JSON est limité en profondeur et doit être une liste d'objets simples.
- Les formules XLSX et les valeurs textuelles assimilables à des formules sont refusées.
- Les colonnes sont mappées explicitement vers les champs autorisés.
- Les contacts, entreprises, produits et opportunités sont validés et dédoublonnés avant écriture.
- L'aperçu persiste uniquement les lignes normalisées; le fichier brut n'est pas conservé.
- Une validation à blanc est obligatoire avant la finalisation par lots.
- Chaque lot est transactionnel, reprenable et audité.
- Les identifiants créés sont conservés pour permettre un retour arrière contrôlé. Le retour arrière échoue sans suppression partielle si une donnée importée ne peut plus être retirée.
- L'accès est limité au propriétaire, aux administrateurs et aux responsables de l'organisation.
- `products`, `imports` et `import_rows` disposent d'index tenant-leading; `products` est protégé par RLS et les tables d'import conservent leurs politiques RLS existantes.

L'ancien import CSV direct reste temporairement disponible comme façade de compatibilité pour les tests et les appels existants. La nouvelle interface utilise exclusivement l'aperçu universel.

## Export universel

- Formats générés: CSV, JSON et XLSX.
- Entités: contacts, entreprises, opportunités, tâches, activités, produits, automatisations et santé des connecteurs.
- Les champs sont choisis dans une liste autorisée par entité; identifiants internes, credentials et payloads ne sont pas exportables.
- La période est obligatoire et limitée à 366 jours.
- Chaque tâche est limitée à 5 000 lignes et chaque fichier à 10 Mo.
- Les valeurs pouvant être exécutées comme formules sont neutralisées dans CSV et XLSX.
- La demande crée un événement durable; le worker génère le fichier de manière idempotente et transactionnelle.
- Le fichier est stocké en base64 dans la ligne tenant-owned, sans URL publique ni stockage partagé.
- Le téléchargement exige une session, le tenant courant et un rôle autorisé. Il utilise `private, no-store`, `nosniff` et un identifiant de corrélation.
- Les fichiers expirent après 24 heures; l'accès et la maintenance suppriment le contenu expiré.
- Une annulation supprime immédiatement le contenu généré et empêche toute reprise du job.
- Demande, succès, échec sûr, téléchargement, expiration et annulation sont audités sans contenu de fichier.
