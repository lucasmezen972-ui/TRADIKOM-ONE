# Moteurs d'import et d'export

Statut: import universel implémenté, export universel à terminer.

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

Prochain checkpoint: génération asynchrone CSV, JSON et XLSX, sélection de champs autorisés, plages bornées, neutralisation des formules, téléchargement authentifié à expiration, annulation, rétention et audit tenant-scoped.
