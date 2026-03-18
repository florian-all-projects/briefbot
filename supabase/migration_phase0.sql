-- ══════════════════════════════════════════════════
-- Migration : Phase 0 (Profil & Niveau)
-- Exécuter dans : Supabase Dashboard → SQL Editor
-- À exécuter UNIQUEMENT si vous avez déjà créé les tables
-- ══════════════════════════════════════════════════

-- Changer la phase par défaut de 1 à 0 pour les nouveaux projets
ALTER TABLE projects ALTER COLUMN current_phase SET DEFAULT 0;
