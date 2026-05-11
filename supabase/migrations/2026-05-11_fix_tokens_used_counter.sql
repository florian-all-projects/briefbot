-- ══════════════════════════════════════════════════
-- Migration : Fix compteur tokens_used qui reste à 0
-- ══════════════════════════════════════════════════
-- Date : 2026-05-11
-- Bug : Le trigger protect_tokens_limit annule silencieusement
-- chaque incrément de tokens_used envoyé par la RPC increment_project_tokens
-- (la RPC est SECURITY DEFINER → s'exécute en tant que postgres, pas service_role).
-- Cost_micro_usd fonctionnait car non protégé par le trigger.
--
-- Fix : la RPC pose un flag de session `app.from_rpc=true` que le trigger
-- vérifie pour autoriser la modification.
-- ══════════════════════════════════════════════════

-- 1. Mettre à jour le trigger pour reconnaitre le flag from_rpc
CREATE OR REPLACE FUNCTION protect_tokens_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tokens_limit IS DISTINCT FROM OLD.tokens_limit
     AND current_setting('role') != 'service_role'
     AND current_setting('app.from_rpc', true) != 'true' THEN
    NEW.tokens_limit := OLD.tokens_limit;
  END IF;
  IF NEW.tokens_used IS DISTINCT FROM OLD.tokens_used
     AND current_setting('role') != 'service_role'
     AND current_setting('app.from_rpc', true) != 'true' THEN
    NEW.tokens_used := OLD.tokens_used;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Mettre à jour la RPC pour poser le flag avant l'UPDATE
CREATE OR REPLACE FUNCTION increment_project_tokens(project_id UUID, amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_total INTEGER;
BEGIN
  PERFORM set_config('app.from_rpc', 'true', true);
  UPDATE projects
  SET tokens_used = COALESCE(tokens_used, 0) + amount
  WHERE id = project_id
  RETURNING tokens_used INTO new_total;
  RETURN new_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Vérification (optionnelle) : tester l'incrément sur un projet existant
-- SELECT increment_project_tokens('UUID-DU-PROJET', 100);
-- SELECT id, name, tokens_used FROM projects WHERE id = 'UUID-DU-PROJET';
