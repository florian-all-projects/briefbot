-- ══════════════════════════════════════════════════
-- Migration : Système de coût réel en USD
-- Exécuter dans : Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- Ajouter les colonnes de coût (en micro-dollars : $1 = 1 000 000)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cost_micro_usd BIGINT DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_micro_usd BIGINT DEFAULT 5000000; -- $5.00 par défaut

-- Migrer les données existantes (estimation grossière des anciens tokens)
-- On garde les anciennes colonnes tokens_used/tokens_limit pour référence
-- mais elles ne seront plus utilisées pour le contrôle de limite

-- Fonction RPC : incrément atomique du coût
CREATE OR REPLACE FUNCTION increment_project_cost(project_id UUID, amount BIGINT)
RETURNS BIGINT AS $$
  UPDATE projects
  SET cost_micro_usd = COALESCE(cost_micro_usd, 0) + amount
  WHERE id = project_id
  RETURNING cost_micro_usd;
$$ LANGUAGE sql SECURITY DEFINER;

-- Protéger budget_micro_usd comme on protège tokens_limit
CREATE OR REPLACE FUNCTION protect_budget()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.budget_micro_usd IS DISTINCT FROM OLD.budget_micro_usd
     AND current_setting('role') != 'service_role' THEN
    NEW.budget_micro_usd := OLD.budget_micro_usd;
  END IF;
  IF NEW.cost_micro_usd IS DISTINCT FROM OLD.cost_micro_usd
     AND current_setting('role') != 'service_role' THEN
    NEW.cost_micro_usd := OLD.cost_micro_usd;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_budget_trigger
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION protect_budget();
