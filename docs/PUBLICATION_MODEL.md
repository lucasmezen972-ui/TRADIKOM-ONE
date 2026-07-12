# Publication Model

The public website now renders the latest immutable published snapshot from `website_publications` joined to `website_versions`.

Draft edits continue to update mutable section rows for the editor. Publishing creates a new `website_versions` snapshot with `version_type='published'` and records it in `website_publications`.

This means editing a draft after publication does not alter live public content until the next publish.

Remaining work:

- rollback publication UI;
- multi-page catch-all route;
- per-page SEO metadata rendering;
- sitemap and robots handling;
- local/S3 asset storage adapter.
