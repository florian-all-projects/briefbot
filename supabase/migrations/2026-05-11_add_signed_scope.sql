-- ══════════════════════════════════════════════════
-- Migration : Ajouter colonne signed_scope
-- ══════════════════════════════════════════════════
-- Date : 2026-05-11
-- But : stocker le cadrage du devis signé par le client
-- (périmètre, pages, modules, budget, délai, hors devis)
-- pour que l'IA reste dans le scope et que Claude-le-constructeur
-- sache quoi générer / quoi ignorer.
-- ══════════════════════════════════════════════════

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS signed_scope TEXT DEFAULT '';

COMMENT ON COLUMN projects.signed_scope IS
  'Cadrage du devis signé (texte libre) : pages, modules, budget, délai, hors périmètre. Utilisé en système prompt pour cadrer les questions de l''IA. Non visible côté client.';
